/**
 * @module LanDirectTransport
 * @description Local-first install path. Posts the archive multipart to
 * the paired agent's `POST /api/plugins/install` endpoint over the LAN
 * with the `X-ADOS-Key` pairing key. The job id and the operator-approved
 * permissions ride the query string, which is where the agent reads them.
 * The agent streams progress for the job over
 * `ws://<agent>/api/plugins/jobs/<jobId>` while the request is open.
 *
 * The route answers only once the install is over, so the request waits past
 * the agent's own bounds. When it succeeds the plugin is enabled on the agent
 * and the grants the agent reports are compared with the ones requested.
 *
 * Failover (callers decide whether to fall through to cloud-relay):
 *   - `TypeError` from `fetch` (network unreachable, mixed-content,
 *     DNS failure)
 *   - HTTP 5xx
 * A timeout never fails over: the install may still be running on the
 * drone, so its outcome is unknown rather than failed.
 *
 * @license GPL-3.0-only
 */

import { PluginAgentClient } from "@/lib/agent/plugin-client";
import {
  LAN_FILE_INSTALL_TIMEOUT_MS,
  type InstallKickoffResult,
  type TransportContext,
} from "./types";

export interface LanDirectInputs extends TransportContext {
  agentUrl: string;
  pairingKey: string;
  /** Random id minted by the dialog so the progress toast can subscribe
   * before the upload completes. The agent echoes it back on the
   * install response and on every WS frame. */
  jobId: string;
}

/** Custom error so callers can branch on failover-eligible failures. */
export class LanDirectError extends Error {
  readonly cause: LanDirectFailureCause;
  readonly status?: number;
  constructor(cause: LanDirectFailureCause, message: string, status?: number) {
    super(message);
    this.cause = cause;
    this.status = status;
  }
}

export type LanDirectFailureCause =
  | "network"
  | "timeout"
  | "server-5xx"
  | "server-4xx"
  | "auth-missing";

/**
 * Upload + install over LAN. Resolves with the kickoff result the
 * progress toast needs; throws `LanDirectError` on any wire-level
 * failure. The dialog inspects the `cause` field to decide whether
 * to fall over to cloud-relay.
 */
export async function installLanDirect(
  inputs: LanDirectInputs,
): Promise<InstallKickoffResult> {
  if (!inputs.pairingKey) {
    throw new LanDirectError(
      "auth-missing",
      "Drone is not paired. Pair the drone before installing a plugin.",
    );
  }

  const form = new FormData();
  form.append("file", inputs.file);
  const query = new URLSearchParams({ job_id: inputs.jobId });
  if (inputs.grantedPermissions.length > 0) {
    // The agent splits this on commas.
    query.set("requested_permissions", inputs.grantedPermissions.join(","));
  }

  const response = await sendLanInstall(
    `${inputs.agentUrl}/api/plugins/install?${query.toString()}`,
    {
      method: "POST",
      headers: { "X-ADOS-Key": inputs.pairingKey },
      body: form,
    },
    LAN_FILE_INSTALL_TIMEOUT_MS,
  );
  return finishLanInstall(response, {
    agentUrl: inputs.agentUrl,
    pairingKey: inputs.pairingKey,
    jobId: inputs.jobId,
    pluginId: inputs.manifest.pluginId,
    pluginName: inputs.manifest.name,
    deviceId: inputs.deviceId,
    requested: inputs.grantedPermissions,
  });
}

/** POST one install request and map wire failures to `LanDirectError`. A
 * non-2xx answer is thrown with the agent's own message. */
export async function sendLanInstall(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new LanDirectError(
        "timeout",
        `The drone did not answer within ${Math.round(timeoutMs / 60_000)} minutes. The install may still be running on it; check the drone's plugin list before retrying.`,
      );
    }
    // `TypeError: Failed to fetch` is the browser's catch-all for
    // network unreachable, DNS failure, mixed-content block, and
    // connection refused. All of these are cloud-eligible.
    if (err instanceof TypeError) {
      throw new LanDirectError("network", `LAN install failed: ${err.message}`);
    }
    throw new LanDirectError(
      "network",
      err instanceof Error ? err.message : String(err),
    );
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
  return response;
}

/** Read the agent's install answer, enable the plugin, and report what the
 * operator needs to know. The install itself already succeeded, so nothing
 * here throws: a grant shortfall or a failed enable becomes a notice. */
export async function finishLanInstall(
  response: Response,
  ctx: {
    agentUrl: string;
    pairingKey: string;
    jobId: string;
    pluginId: string;
    pluginName: string;
    deviceId: string;
    requested: ReadonlyArray<string>;
  },
): Promise<InstallKickoffResult> {
  const body = (await response.json().catch(() => null)) as {
    plugin_id?: unknown;
    granted?: unknown;
  } | null;
  const pluginId = typeof body?.plugin_id === "string" ? body.plugin_id : ctx.pluginId;
  const granted = Array.isArray(body?.granted)
    ? body.granted.filter((g): g is string => typeof g === "string")
    : [];
  const notices: string[] = [];
  const notGranted = ctx.requested.filter((p) => !granted.includes(p));
  if (notGranted.length > 0) {
    notices.push(`The drone did not grant: ${notGranted.join(", ")}.`);
  }

  let enabledOnAgent = false;
  try {
    await new PluginAgentClient(ctx.agentUrl, ctx.pairingKey).enable(pluginId);
    enabledOnAgent = true;
  } catch (err) {
    notices.push(
      `Installed, but the drone did not enable it (${err instanceof Error ? err.message : String(err)}). Enable it from the drone's Plugins tab.`,
    );
  }

  return {
    transport: "lan",
    jobId: ctx.jobId,
    pluginId,
    pluginName: ctx.pluginName,
    deviceId: ctx.deviceId,
    enabledOnAgent,
    ...(notices.length > 0 ? { notice: notices.join(" ") } : {}),
  };
}

/** Policy: which `LanDirectError` causes should fall over to cloud? A
 * network failure or a 5xx. Not a hard 4xx (a bad archive or a rejected
 * permission set; cloud won't fix that), and never a timeout: the install
 * may still be running on the drone, and a second install through the
 * cloud would race it. */
export function shouldFailover(err: LanDirectError): boolean {
  return err.cause === "network" || err.cause === "server-5xx";
}

/**
 * Build a clear error message from the agent's response body. The
 * supervisor returns a structured envelope `{ok: false, kind, detail}`
 * on every non-2xx; surface `kind` and `detail` when present so the
 * operator sees something readable instead of a raw JSON blob. Falls
 * back to the original `<status>: <text>` shape when the body isn't
 * the structured envelope.
 */
export function buildAgentErrorMessage(status: number, text: string): string {
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "kind" in parsed &&
        "detail" in parsed
      ) {
        const kind = String((parsed as { kind: unknown }).kind ?? "");
        const detail = String((parsed as { detail: unknown }).detail ?? "");
        if (kind || detail) {
          return `Agent rejected install (${kind || "error"}): ${
            detail || `HTTP ${status}`
          }`;
        }
      }
    } catch {
      // Body wasn't JSON — fall through to raw-text shape.
    }
  }
  return `Agent returned ${status}${text ? `: ${text}` : ""}`;
}
