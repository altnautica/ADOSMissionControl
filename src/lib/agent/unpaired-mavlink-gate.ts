/**
 * @module agent/unpaired-mavlink-gate
 * @description Decides whether a keyless dial of an agent's MAVLink WebSocket
 * proxy can be admitted. An unpaired agent refuses that WebSocket to every
 * caller except one on its own box or on one of its lifelines (its Wi-Fi
 * hotspot, its USB gadget link, link-local). Dialing it bare from an ordinary
 * LAN cannot succeed, so the GCS asks the agent first and, when it reports
 * itself unpaired, offers pairing instead of a link that will never open.
 * @license GPL-3.0-only
 */

import { isDemoMode } from "@/lib/utils";
import { probeAgent } from "./local-pair/probe";

/**
 * True when `hostname` is an agent address on one of the links an unpaired
 * agent still admits: loopback (the GCS runs on the agent's own box), the
 * hotspot subnet 192.168.4.0/24, the USB gadget subnet 192.168.7.0/24, or
 * link-local 169.254.0.0/16. The GCS reaches the agent at an address on the
 * link it is itself on, so the agent's address names the caller's link.
 */
export function isAgentLifelineHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  return (
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 168 && (c === 4 || c === 7))
  );
}

/**
 * Ask the agent at `agentBase` (its REST origin) whether it is paired, via
 * `/api/pairing/info` (through the same-origin probe proxy on an https GCS).
 * Resolves true only on a definitive `paired: false`. An unreachable agent or
 * a malformed answer resolves false: the dial then fails, or succeeds, as an
 * ordinary link would. Demo mode never reaches a real agent and never blocks.
 */
export async function agentReportsUnpaired(
  agentBase: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (isDemoMode()) return false;
  try {
    const info = await probeAgent(agentBase, signal);
    return info.paired === false;
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}
