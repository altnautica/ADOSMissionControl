/**
 * @module agent/local-pair/code-pair
 * @description Anonymous 6-character pair-code flow. Resolves a code to
 * an agent hostname — LAN-first via mDNS scan, with an optional Convex
 * fallback for cross-network discovery — then chains into the normal
 * hostname-probe flow. The mDNS scan itself lives in
 * `../discovery/mdns-client`; this module owns the code charset rules
 * and the LAN-first ordering.
 * @license GPL-3.0-only
 */

import { findHostByCodeOnLan as findHostByCodeOnLanImpl } from "../discovery/mdns-client";
import type { CodeClaimResult, ProbeResult } from "./types";
import { AgentAlreadyPairedError, PairClientError } from "./errors";
import { combineSignals } from "./transport";
import { probeAgent } from "./probe";

/** Pair codes use the agent's safe charset (uppercase letters and
 *  digits, with 0/O/1/I/L removed for readability). A 6-char input
 *  matching this regex is unambiguously a code; anything else is a
 *  hostname. The disjoint character sets keep auto-detection clean.
 */
const PAIR_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function looksLikePairCode(input: string): boolean {
  return PAIR_CODE_RE.test(input.trim().toUpperCase());
}

/** Re-export of the LAN discovery scan with the local `combineSignals`
 *  helper bound. Keeps the public surface of this module unchanged for
 *  callers that import the function by name. */
export function findHostByCodeOnLan(
  code: string,
  signal?: AbortSignal,
): ReturnType<typeof findHostByCodeOnLanImpl> {
  return findHostByCodeOnLanImpl(code, combineSignals, signal);
}

/** Anonymous code-pair: resolve a 6-character pair code into an agent
 *  hostname, then chain into the normal hostname-probe flow. Tries
 *  the LAN first via mDNS scan (works without internet, without sign
 *  in, without the agent's cloud beacon being enabled). If no LAN
 *  agent advertises the code, falls back to the Convex anon mutation
 *  for cross-network discovery (requires the agent to be beaconing
 *  to Convex, see PairingConfig.beacon_enabled).
 *
 *  Mixed-content safe: every call goes through Mission Control's own
 *  proxy routes which resolve mDNS server-side.
 */
export async function probeByCode(
  rawCode: string,
  // Takes the code only. Acquiring the anonymous cloud session the relay needs
  // is the caller's job (see `AddNodeForm`), so this module stays free of both
  // Convex and credential handling — and there is no argument here that names
  // an owner, which is the property the relay now enforces server-side.
  claimAnon?: (args: { code: string }) => Promise<CodeClaimResult>,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const cleaned = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!PAIR_CODE_RE.test(cleaned)) {
    throw new PairClientError(
      "badCodeError",
      "Pair code must be six characters (letters and digits).",
    );
  }

  // 1) LAN-first (the primary path): discover ADOS agents on the local subnet
  //    via mDNS and pick the one whose published code matches. Local-only, no
  //    Convex round-trip, works when the agent's cloud beacon is disabled (the
  //    default since agent 0.26.5) and when the GCS has no relay at all.
  const lan = await findHostByCodeOnLan(cleaned, signal);
  if (lan.matchedHost) {
    return probeAgent(lan.matchedHost, signal);
  }

  // A nearby-codes hint so a rotated code is recoverable in one step.
  const hint =
    lan.unpaired.length > 0
      ? ` Nearby unpaired agents: ${lan.unpaired
          .map((a) => `${a.name} → ${a.code}`)
          .join(", ")}.`
      : "";

  // 2) Optional cross-network fallback via Convex, for a remote agent that
  //    beacons to the relay (opt-in). Skipped entirely when the relay isn't
  //    available (offline / signed out) so a fully-offline GCS still gets the
  //    local-first guidance below instead of a cloud error. The relay returns a
  //    normal result, not a throw, when it does not know the code, which keeps
  //    the browser console clean.
  if (claimAnon) {
    const lookup = await claimAnon({ code: cleaned });
    if (lookup.error === "device_owned_by_other") {
      throw new AgentAlreadyPairedError(
        "This drone is already paired to another owner. Unpair it on the device, or sign in to claim it.",
      );
    }
    if (!lookup.error) {
      // Prefer the agent's mDNS host so a DHCP renumber doesn't kill future
      // sessions; the proxy route resolves it server-side.
      const hostFrom = lookup.mdnsHost || lookup.localIp || "";
      if (!hostFrom) {
        throw new PairClientError(
          "codeNoHostError",
          "Pair code is valid but the agent hasn't advertised a network address yet. Wait a few seconds and try again.",
        );
      }
      return probeAgent(hostFrom, signal);
    }
    // lookup.error truthy → fall through to the local-first error below.
  }

  // No LAN agent advertises the code (and no relay match). Point at the
  // reliable local path — same Wi-Fi, the current code, or hostname/IP — rather
  // than at cloud relay, which is the secondary path for remote access only.
  throw new PairClientError(
    "codeNoLanMatchError",
    `No agent on this LAN is advertising that pair code. Make sure you're on the same Wi-Fi and \`ados status\` on the agent shows this code, or add the agent by its hostname or IP instead.${hint}`,
    { hint },
  );
}
