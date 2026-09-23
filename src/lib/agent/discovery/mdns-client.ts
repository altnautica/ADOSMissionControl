/**
 * @module agent/discovery/mdns-client
 * @description LAN-side discovery helpers for the local-first pair
 * flow. Routes through Mission Control's own `/api/lan-pair/*`
 * endpoints, which resolve mDNS server-side via the OS resolver
 * (browsers don't speak `*.local` reliably).
 * @license GPL-3.0-only
 */

import { withTimeoutSignal } from "../agent-client/timeout";

/** Result shape returned by the LAN discover route. */
export interface LanDiscoveredAgent {
  host: string;
  ipv4?: string;
  port: number;
  txt: Record<string, string>;
}

/** Summary of one unpaired agent visible on the LAN, used to give the
 *  operator a fresh pair-code hint when their typed code missed. */
export interface LanScanCandidate {
  name: string;
  /** Current pair code visible on the agent. Codes rotate on a TTL,
   *  so this is the value at probe time. */
  code: string;
  /** Best-effort hostname for the user to recognise the agent. */
  host: string;
}

/** Result of a LAN scan-by-code: the matched host (or null if the
 *  entered code didn't match anything we could see) plus the list
 *  of unpaired LAN agents whose info we successfully read. Lets the
 *  caller surface a "did you mean these?" hint when no match. */
export interface LanScanResult {
  matchedHost: string | null;
  unpaired: LanScanCandidate[];
}

/** Probe each LAN-discovered agent for its current pair code. Returns
 *  the host whose code matches AND a list of every unpaired agent we
 *  could see, so the caller can hint at fresh codes if the input was
 *  stale (codes rotate on a 15-minute TTL). Errors per-agent are
 *  swallowed so one slow node can't poison the whole scan; the
 *  surviving probes still populate ``unpaired``.
 */
export async function findHostByCodeOnLan(
  code: string,
  signal?: AbortSignal,
): Promise<LanScanResult> {
  try {
    const discoverResp = await fetch("/api/lan-pair/discover", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: withTimeoutSignal(5000, signal ?? null),
    });
    if (!discoverResp.ok) return { matchedHost: null, unpaired: [] };
    const { agents } = (await discoverResp.json()) as {
      agents?: LanDiscoveredAgent[];
    };
    if (!agents || agents.length === 0) {
      return { matchedHost: null, unpaired: [] };
    }

    // Probe every candidate target in parallel. An mDNS record can
    // carry a stale IPv4 (agent renumbered after a DHCP lease change
    // or briefly served its own WiFi AP) while the hostname still
    // resolves correctly, or vice versa. Trying both per agent keeps
    // the scan tolerant of either staleness.
    const targets: string[] = [];
    for (const a of agents) {
      if (a.host) targets.push(a.host);
      if (a.ipv4) targets.push(a.ipv4);
    }
    interface ProbeOutcome {
      target: string;
      info: {
        device_id?: string;
        name?: string;
        pairing_code?: string | null;
        paired?: boolean;
        mdns_host?: string;
      } | null;
    }
    const probes: Promise<ProbeOutcome>[] = targets.map(async (target) => {
      try {
        const probeResp = await fetch("/api/lan-pair/probe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ host: target }),
          signal: withTimeoutSignal(4000, signal ?? null),
        });
        if (!probeResp.ok) return { target, info: null };
        const info = (await probeResp.json()) as ProbeOutcome["info"];
        return { target, info };
      } catch {
        return { target, info: null };
      }
    });
    const outcomes = await Promise.all(probes);

    // Dedupe by device_id so the host+ipv4 dual probe doesn't list
    // the same agent twice in the unpaired summary.
    const byDeviceId = new Map<string, { target: string; info: ProbeOutcome["info"] }>();
    for (const o of outcomes) {
      if (!o.info) continue;
      const id = o.info.device_id;
      if (!id) continue;
      if (!byDeviceId.has(id)) byDeviceId.set(id, o);
    }

    let matchedHost: string | null = null;
    const unpaired: LanScanCandidate[] = [];
    for (const { target, info } of byDeviceId.values()) {
      if (!info) continue;
      if (info.paired) continue;
      // ``target`` is the host we just successfully reached. Prefer
      // it over ``info.mdns_host`` (which the agent advertises but is
      // often only resolvable via the bonjour-service's own cache —
      // the OS resolver may not have it). The OS-level hostname like
      // ``testnode.local`` is what bonjour returned as ``host`` and
      // what avahi-daemon on the SBC actually publishes.
      const host = target;
      const codeVal = info.pairing_code ?? "";
      if (codeVal) {
        unpaired.push({
          name: info.name || info.device_id || host,
          code: codeVal,
          host,
        });
      }
      if (codeVal === code && !matchedHost) {
        matchedHost = host;
      }
    }
    return { matchedHost, unpaired };
  } catch {
    return { matchedHost: null, unpaired: [] };
  }
}
