/**
 * @module LanPairIpv4
 * @description Server-only IPv4 resolution for the LAN-pair proxy routes.
 *
 * Resolving an agent's `.local` (mDNS) hostname does an A *and* AAAA lookup.
 * When the box advertises no usable IPv6 (the common case — a Pi on Wi-Fi with
 * no IPv6 address) the AAAA query gets no fast negative answer and the OS
 * resolver waits out its ~5 s timeout before falling back to the A record. That
 * delay alone blows the proxy's 8 s upstream budget, so a pair probe/claim
 * against a `.local` host times out even though the agent answers instantly by
 * IPv4. Resolving to IPv4 first (A-record only) sidesteps the AAAA wait.
 *
 * Co-located under the route folder (and named with a leading underscore) so it
 * is never treated as a route. Node-only — it imports `node:dns` — and must NOT
 * be imported from the browser bundle (unlike the pure `host-validation.ts`).
 *
 * @license GPL-3.0-only
 */

import { promises as dns } from "node:dns";
import { isPrivateIpv4 } from "@/lib/agent/host-validation";

/** Resolve a hostname to an IPv4 address (A-record only). Returns the input
 * unchanged when it is already a dotted-quad literal (it only reaches here after
 * `normaliseAndCheckHost` classified it as a private literal), and null on
 * failure.
 *
 * Defense-in-depth against DNS / mDNS rebinding: `normaliseAndCheckHost` admits
 * exactly one DNS-resolvable host — a `.local` mDNS name — but a poisoned
 * resolver could point that name at a PUBLIC address. So a resolved address that
 * is not private (RFC1918 / loopback / link-local) is refused (null) rather than
 * handed back for the proxy to fetch with the operator's key. */
export async function resolveIpv4(hostname: string): Promise<string | null> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  try {
    const { address } = await dns.lookup(hostname, { family: 4 });
    if (!address || !isPrivateIpv4(address)) return null;
    return address;
  } catch {
    return null;
  }
}

/** Build the upstream fetch base for a validated target, preferring the
 * resolved IPv4 address over the `.local` hostname so the upstream fetch never
 * eats the IPv6-first resolution delay. Falls back to the original hostname URL
 * when IPv4 resolution fails (the agent's :8080 API is host-agnostic, so the
 * swapped Host needs no preservation). */
export async function ipv4FetchBase(target: {
  url: string;
  host: string;
}): Promise<string> {
  const ip = await resolveIpv4(target.host);
  if (!ip || ip === target.host) return target.url;
  try {
    const u = new URL(target.url);
    u.hostname = ip;
    return u.origin;
  } catch {
    return target.url;
  }
}
