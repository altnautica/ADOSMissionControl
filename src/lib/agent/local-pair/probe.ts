/**
 * @module agent/local-pair/probe
 * @description Hits the agent's ``/api/pairing/info`` route and parses
 * the identity + radio/bind state into a `ProbeResult`. This is the
 * read-only half of the pair flow — it never mutates the agent.
 * @license GPL-3.0-only
 */

import { isDemoMode } from "@/lib/utils";
import type { ProbeResult } from "./types";
import { PairClientError } from "./errors";
import { withTimeoutSignal } from "../agent-client/timeout";
import { FETCH_TIMEOUT_MS, normaliseHost, safeJson, shouldUseProxy } from "./transport";
import { pairFailureFromResponse } from "./failure-copy";

/** Hit ``/api/pairing/info`` and return the agent identity.
 * Bounded by the pair-flow deadline so a non-responsive host doesn't hang
 * the UI.
 *
 * In a browser the request always goes through Mission Control's own
 * `/api/lan-pair/probe` route, which forwards it to the LAN agent
 * server-side (see `shouldUseProxy`); only a window-less caller fetches the
 * agent directly. Either way a request nothing answered maps onto the
 * unreachable copy rather than escaping as a raw fetch error.
 */
export async function probeAgent(
  rawHost: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const host = normaliseHost(rawHost);
  if (!host) {
    throw new PairClientError("enterHostnameError", "Enter a hostname or URL to probe");
  }
  // Demo mode never reaches a real agent. Return a representative
  // probe so the Add-a-Node card renders the bind-state surface.
  if (isDemoMode()) {
    return {
      deviceId: "ados-demo01",
      name: "Demo Drone",
      version: "0.0.0-demo",
      board: "Demo Board",
      paired: false,
      radioPaired: true,
      radioPeerDeviceId: "ados-demo-gs",
      mdnsHost: "ados-demo01.local",
      profile: "drone",
      role: null,
      hostname: host,
      bindState: {
        state: "binding",
        phase: "key-exchange",
        active: true,
        error: null,
        finishedAt: null,
        fingerprint: "a1b2c3d4e5f60718",
      },
      radio: { state: "connected", rssiDbm: -48, packetsReceived: 12840 },
    };
  }
  let body: Record<string, unknown>;
  if (shouldUseProxy()) {
    // The route answers its own unreachable reply when the agent is silent;
    // a rejection here means the route itself did not answer in time.
    let resp: Response;
    try {
      resp = await fetch(`/api/lan-pair/probe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ host }),
        signal: withTimeoutSignal(FETCH_TIMEOUT_MS, signal ?? null),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw pairFailureFromResponse("probe", host, { status: 0 }, null);
    }
    if (!resp.ok) {
      throw pairFailureFromResponse("probe", host, resp, await safeJson(resp));
    }
    body = (await resp.json()) as Record<string, unknown>;
  } else {
    // Direct path (no window): a fetch rejection here is a real "nothing
    // answered" — DNS failure, connection refused, or the timeout — so it
    // maps onto the same unreachable branch the proxy's 502 produces rather
    // than escaping as a raw TypeError. An operator-triggered abort is not a
    // failure and is re-thrown untouched.
    let resp: Response;
    try {
      resp = await fetch(`${host}/api/pairing/info`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: withTimeoutSignal(FETCH_TIMEOUT_MS, signal ?? null),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw pairFailureFromResponse("probe", host, { status: 0 }, null);
    }
    if (!resp.ok) {
      throw pairFailureFromResponse("probe", host, resp, await safeJson(resp));
    }
    body = (await resp.json()) as Record<string, unknown>;
  }
  const deviceId = String(body.device_id ?? "");
  if (!deviceId) {
    throw new PairClientError("missingDeviceIdError", "Probe response missing device_id");
  }
  const profile = (body.profile as string) || "drone";
  const role = (body.role as string | undefined) ?? null;
  const ipv4 =
    typeof body.ipv4 === "string" && body.ipv4.length > 0
      ? body.ipv4
      : undefined;
  return {
    deviceId,
    name: String(body.name ?? "ADOS Agent"),
    version: String(body.version ?? ""),
    board: String(body.board ?? "unknown"),
    paired: Boolean(body.paired),
    radioPaired: Boolean(body.radio_paired),
    radioPeerDeviceId:
      typeof body.radio_peer_device_id === "string"
      && (body.radio_peer_device_id as string).length > 0
        ? (body.radio_peer_device_id as string)
        : null,
    pairingCode: (body.pairing_code as string | undefined) ?? undefined,
    ownerId: (body.owner_id as string | undefined) ?? undefined,
    pairedAt: (body.paired_at as number | undefined) ?? undefined,
    mdnsHost: String(body.mdns_host ?? ""),
    profile: profile as ProbeResult["profile"],
    role: role as ProbeResult["role"],
    hostname: host,
    ipv4,
    bindState:
      body.bind_state && typeof body.bind_state === "object"
        ? (() => {
            const b = body.bind_state as Record<string, unknown>;
            return {
              state: (b.state as string | null | undefined) ?? null,
              phase: (b.phase as string | null | undefined) ?? null,
              active: Boolean(b.active),
              error: (b.error as string | null | undefined) ?? null,
              finishedAt:
                typeof b.finished_at === "number" ? b.finished_at : null,
              fingerprint: (b.fingerprint as string | null | undefined) ?? null,
            };
          })()
        : undefined,
    radio:
      body.radio && typeof body.radio === "object"
        ? (() => {
            const r = body.radio as Record<string, unknown>;
            return {
              state: (r.state as string | null | undefined) ?? null,
              rssiDbm: typeof r.rssi_dbm === "number" ? r.rssi_dbm : null,
              packetsReceived:
                typeof r.packets_received === "number"
                  ? r.packets_received
                  : null,
            };
          })()
        : undefined,
  };
}
