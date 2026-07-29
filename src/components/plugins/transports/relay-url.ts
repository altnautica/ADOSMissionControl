/**
 * @module RelayUrlTransport
 * @description Relay-proxy install path for a drone reached only through a
 * ground station's WFB radio relay — no LAN or cloud identity of its own.
 * Mirrors {@link installLanDirectFromUrl} except the request crosses
 * `gs_relay_proxy.rs`'s aux-radio tunnel, whose request side is a single
 * aux frame capped at `AUX_MAX_PAYLOAD = 1200 B`
 * (`ADOSDroneAgent/crates/ados-protocol/src/aux_rpc.rs`). A `.adosplug`
 * archive can never fit that, so this transport POSTs only the tiny
 * `{url, sha256}` pointer to the same `install_from_url` endpoint the LAN
 * path uses, and the drone — which sits on its own LAN with an upstream
 * route — fetches and verifies the archive itself.
 *
 * The LAN job-ticket WebSocket (`POST /api/plugins/jobs/{jobId}/ticket`
 * then `new WebSocket(..., ["ados-job-ticket", ticket])`) does not tunnel
 * through the relay proxy in this phase — it carries request/response RPC
 * only, no long-lived stream. `pollRelayInstallProgress` stands in for it:
 * a fixed-interval poll of the agent's job-status endpoint, mirrored into
 * the shared `useInstallProgressStore` so every surface watching a job id
 * sees relay progress the same way it would see a LAN or cloud one.
 *
 * @license GPL-3.0-only
 */

import {
  LanDirectError,
  buildAgentErrorMessage,
  type LanDirectFailureCause,
} from "./lan-direct";
import type { InstallKickoffResult } from "./types";
import {
  useInstallProgressStore,
  type InstallJobError,
  type InstallStage,
} from "../install-progress-store";

/** Longer than the LAN path's 60s total ceiling: the agent downloads and
 * verifies the archive itself, agent-side, before it ever answers this
 * request, and the request/response round trip additionally crosses the
 * WFB radio twice. Also the polling loop's hard cap. */
export const RELAY_INSTALL_TIMEOUT_MS = 90_000;

/** How often `pollRelayInstallProgress` re-checks job status while a
 * relay install is in flight. */
const RELAY_POLL_INTERVAL_MS = 2_000;

export interface RelayInstallFromUrlInputs {
  /** Relay-proxy base URL:
   * `{groundStationHost}/api/v1/ground-station/relay-proxy/{peerDeviceId}`,
   * from {@link relayProxyBaseUrl}. */
  relayBaseUrl: string;
  /** The ground station's own paired API key — the drone has no LAN
   * identity of its own, so every relay call authenticates as the
   * ground station relaying it. */
  apiKey: string;
  /** Canonical archive URL the agent will fetch. */
  url: string;
  /** Lowercase hex SHA-256 of the archive bytes; the agent rejects on
   * mismatch with `sha256_mismatch`. */
  sha256: string;
  /** Random job id minted by the dialog. Echoed back by the agent and
   * used as the poll key for {@link pollRelayInstallProgress}. */
  jobId: string;
  /** Manifest plugin id, surfaced on the kickoff result. */
  pluginId: string;
  /** Display name shown on the progress toast. */
  pluginName: string;
  /** Device id the progress toast scopes status queries to. */
  deviceId: string;
}

/**
 * Drive the agent through the install-from-URL endpoint over the relay
 * proxy. Resolves with the kickoff result once the agent's response
 * lands (the agent answers only after it has downloaded, verified, and
 * installed the archive, so a 200 here means the install is already
 * done); throws `LanDirectError` on any wire-level failure so the dialog
 * can render its message.
 *
 * Deliberately has no failover branch: a relay install that fails must
 * surface that failure, never fall through to cloud-relay silently — the
 * exact bug this transport fixes.
 */
export async function installRelayFromUrl(
  inputs: RelayInstallFromUrlInputs,
): Promise<InstallKickoffResult> {
  if (!inputs.apiKey) {
    throw new LanDirectError(
      "auth-missing",
      "Ground station is not paired. Pair the ground station relaying this drone before installing a plugin.",
    );
  }

  // The relay-proxy request body rides a single aux radio frame, capped at
  // AUX_MAX_PAYLOAD = 1200 B (ADOSDroneAgent/crates/ados-protocol/src/aux_rpc.rs).
  // Keep this to exactly the two fields install_from_url needs — nothing
  // else, so a long URL never has to compete with other fields for the
  // remaining headroom.
  const body = JSON.stringify({
    url: inputs.url,
    sha256: inputs.sha256,
  });

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("relay-timeout", "AbortError")),
    RELAY_INSTALL_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(
      `${inputs.relayBaseUrl}/api/plugins/install_from_url`,
      {
        method: "POST",
        headers: {
          "X-ADOS-Key": inputs.apiKey,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new LanDirectError(
        "timeout",
        "Install request did not reach the drone over the radio link.",
      );
    }
    // `TypeError: Failed to fetch` covers network-unreachable, DNS
    // failure, mixed-content block, and connection refused against the
    // ground station itself.
    throw new LanDirectError(
      "network",
      err instanceof Error
        ? `Relay install-from-URL failed: ${err.message}`
        : String(err),
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const cause: LanDirectFailureCause =
      response.status >= 500 ? "server-5xx" : "server-4xx";
    throw new LanDirectError(
      cause,
      buildAgentErrorMessage(response.status, text),
      response.status,
    );
  }

  return {
    transport: "relay",
    jobId: inputs.jobId,
    pluginId: inputs.pluginId,
    pluginName: inputs.pluginName,
    deviceId: inputs.deviceId,
  };
}

export interface RelayInstallProgressPollArgs {
  relayBaseUrl: string;
  apiKey: string;
  jobId: string;
  pluginName?: string;
  pluginVersion?: string;
  deviceId?: string;
}

/** Wire shape of `GET {relayBase}/api/plugins/jobs/{jobId}` — the same
 * job-status fields the LAN WebSocket frame carries, so a poll tick and a
 * WS frame can drive the identical store update. */
interface RelayJobStatus {
  stage?: InstallStage;
  installId?: string;
  error?: InstallJobError;
}

/**
 * Poll the agent's job-status endpoint over the relay proxy and mirror
 * each stage into the shared `useInstallProgressStore`, since the relay
 * lane carries request/response RPC only — no long-lived WebSocket
 * tunnel exists for it in this phase.
 *
 * Seeds a `verifying` snapshot immediately so the dialog is never left
 * with zero progress signal while the kickoff POST is still in flight,
 * then polls every `RELAY_POLL_INTERVAL_MS`. Skips the `uploading` stage
 * entirely — the agent fetches the archive itself, so nothing is ever
 * uploaded from the browser's side. Stops on a terminal stage or once
 * `RELAY_INSTALL_TIMEOUT_MS` elapses, matching the kickoff request's own
 * ceiling, and reports the same "did not reach the drone" message on
 * that timeout so a caller that never got a job-status row still fails
 * honestly rather than spinning forever.
 *
 * Returns a stop function; callers stop the poll themselves once the
 * kickoff request resolves (success or failure) so a fast agent reply
 * never races a stale poll tick into overwriting the real outcome.
 */
export function pollRelayInstallProgress(
  args: RelayInstallProgressPollArgs,
): () => void {
  const { relayBaseUrl, apiKey, jobId } = args;
  const upsert = useInstallProgressStore.getState().upsert;
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const snapshot = (stage: InstallStage, extra?: RelayJobStatus) => {
    upsert({
      jobId,
      stage,
      transport: "relay",
      updatedAt: Date.now(),
      installId: extra?.installId,
      error: extra?.error,
      pluginName: args.pluginName,
      pluginVersion: args.pluginVersion,
      deviceId: args.deviceId,
    });
  };

  snapshot("verifying");

  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (Date.now() - startedAt > RELAY_INSTALL_TIMEOUT_MS) {
      snapshot("failed", {
        error: {
          code: "relay_timeout",
          message:
            "Install request did not reach the drone over the radio link.",
        },
      });
      return;
    }
    try {
      const resp = await fetch(
        `${relayBaseUrl}/api/plugins/jobs/${encodeURIComponent(jobId)}`,
        { headers: { "X-ADOS-Key": apiKey } },
      );
      if (resp.ok) {
        const body = (await resp.json()) as RelayJobStatus;
        if (body.stage && body.stage !== "uploading") {
          snapshot(body.stage, body);
          if (body.stage === "completed" || body.stage === "failed") return;
        }
      }
    } catch {
      // Transient poll failure over a shared WFB lane — keep polling
      // until the timeout above gives up rather than failing on one
      // dropped frame.
    }
    if (stopped) return;
    timer = setTimeout(() => void tick(), RELAY_POLL_INTERVAL_MS);
  };

  timer = setTimeout(() => void tick(), RELAY_POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
