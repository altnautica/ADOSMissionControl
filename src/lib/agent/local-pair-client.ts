/**
 * @module LocalPairClient
 * @description REST helpers for the local-first pair flow used by
 * the Add-a-Node card. Hits the agent's existing
 * ``/api/pairing/info`` and ``/api/pairing/claim`` endpoints
 * directly over LAN. No Convex round-trip.
 *
 * The agent treats the act of being on the same LAN as the auth
 * boundary for these two routes — claim only works while the agent
 * is unpaired, and the returned API key is what the GCS uses for
 * every subsequent call.
 *
 * This file is a thin barrel: the credential-exchange helpers live in
 * `./local-pair/*` (types, errors, transport, probe, claim, unpair,
 * code-pair) and the mDNS / `/api/lan-pair/discover` scan logic lives
 * in `./discovery/mdns-client`. Callers keep importing every name from
 * this path unchanged.
 *
 * @license GPL-3.0-only
 */

export type {
  AgentBindState,
  AgentRadioSnapshot,
  ProbeResult,
  ClaimResult,
  CodeClaimResult,
} from "./local-pair/types";

export type {
  LanScanCandidate,
  LanScanResult,
} from "./discovery/mdns-client";

export type { DashboardPinStatus } from "./local-pair/dashboard-pin";

export { AgentAlreadyPairedError, PairClientError } from "./local-pair/errors";
export { normaliseHost } from "./local-pair/transport";
export { probeAgent } from "./local-pair/probe";
export { pairLocally } from "./local-pair/claim";
export { unpairLocal } from "./local-pair/unpair";
export {
  getDashboardPinStatus,
  setDashboardPin,
  clearDashboardPin,
} from "./local-pair/dashboard-pin";
export { looksLikePairCode, probeByCode } from "./local-pair/code-pair";
export { findHostByCodeOnLan } from "./discovery/mdns-client";
