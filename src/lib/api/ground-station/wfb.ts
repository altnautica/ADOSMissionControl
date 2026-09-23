// WFB-ng radio config plus distributed receive (relay and receiver) status.

import type { WfbConfig } from "@/stores/ground-station-store";
import type {
  AutoPairToggleResponse,
  LocalBindSession,
  PairResult,
  PairStatusResponse,
  SetTxPowerResult,
  UnpairResult,
  VideoConfigResponse,
  WfbReceiverCombined,
  WfbReceiverRelay,
  WfbReceiverRelays,
  WfbRelayStatus,
} from "./types";
import { gsRequest, type RequestContext } from "./request";

/** Operator-facing radio link presets the agent maps to an (mcs, fec) trio. */
export type LinkPreset = "conservative" | "balanced" | "aggressive";

export function getWfb(ctx: RequestContext): Promise<WfbConfig> {
  return gsRequest<WfbConfig>(ctx, "/api/v1/ground-station/wfb");
}

export function setWfb(ctx: RequestContext, partial: Partial<WfbConfig>): Promise<WfbConfig> {
  return gsRequest<WfbConfig>(ctx, "/api/v1/ground-station/wfb", {
    method: "PUT",
    body: JSON.stringify(partial),
  });
}

/** Set the requested TX power in dBm. The agent clamps to the active
 *  driver's maximum and returns the effective value alongside the cap. */
export function setTxPower(
  ctx: RequestContext,
  dbm: number,
): Promise<SetTxPowerResult> {
  return gsRequest<SetTxPowerResult>(ctx, "/api/wfb/tx-power", {
    method: "PUT",
    body: JSON.stringify({ tx_power_dbm: dbm }),
  });
}

// ─── Radio link tuning ──────────────────────────────────────────
// These drive the drone agent's POST /api/video/config route (the agent
// applies the knob to the live data plane and persists it). Each returns the
// agent's response with a `warnings` array so a partial apply is visible. The
// card reads the resulting live values back from the per-drone radio snapshot.

/** Set the Reed-Solomon FEC ratio (k data shards, n total). Requires n > k. */
export function setFec(
  ctx: RequestContext,
  fecK: number,
  fecN: number,
): Promise<VideoConfigResponse> {
  return gsRequest<VideoConfigResponse>(ctx, "/api/video/config", {
    method: "POST",
    body: JSON.stringify({ fec_k: fecK, fec_n: fecN }),
  });
}

/** Set the 802.11 MCS index (0-7) the transmitter sends at. */
export function setMcs(
  ctx: RequestContext,
  mcs: number,
): Promise<VideoConfigResponse> {
  return gsRequest<VideoConfigResponse>(ctx, "/api/video/config", {
    method: "POST",
    body: JSON.stringify({ mcs }),
  });
}

/** Apply a named link preset (sets the base rate + redundancy trio). */
export function setPreset(
  ctx: RequestContext,
  preset: LinkPreset,
): Promise<VideoConfigResponse> {
  return gsRequest<VideoConfigResponse>(ctx, "/api/video/config", {
    method: "POST",
    body: JSON.stringify({ preset }),
  });
}

/** Arm (true) or disarm (false) the closed-loop adaptive FEC controller. */
export function setAdaptive(
  ctx: RequestContext,
  enabled: boolean,
): Promise<VideoConfigResponse> {
  return gsRequest<VideoConfigResponse>(ctx, "/api/video/config", {
    method: "POST",
    body: JSON.stringify({ auto: enabled }),
  });
}

export function pairDrone(
  ctx: RequestContext,
  pairKey: string,
  droneId?: string,
): Promise<PairResult> {
  const body: Record<string, string> = { pair_key: pairKey };
  if (droneId) body.drone_device_id = droneId;
  return gsRequest<PairResult>(ctx, "/api/v1/ground-station/wfb/pair", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function unpairDrone(ctx: RequestContext): Promise<UnpairResult> {
  return gsRequest<UnpairResult>(ctx, "/api/v1/ground-station/wfb/pair", {
    method: "DELETE",
  });
}

type Raw = Record<string, unknown>;
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Relay-side WFB fragment counters plus receiver reachability. A stale
 *  answer carries nulls (or no keys at all); both read as null here. */
export async function getWfbRelayStatus(ctx: RequestContext): Promise<WfbRelayStatus> {
  const r = await gsRequest<Raw>(ctx, "/api/v1/ground-station/wfb/relay/status");
  return {
    role: r.role === "relay" ? "relay" : null,
    drone_iface: strOrNull(r.drone_iface),
    receiver_ip: strOrNull(r.receiver_ip),
    receiver_port: numOrNull(r.receiver_port),
    receiver_last_seen_ms: numOrNull(r.receiver_last_seen_ms),
    fragments_seen: numOrNull(r.fragments_seen),
    fragments_forwarded: numOrNull(r.fragments_forwarded),
    up: boolOrNull(r.up),
    mesh_iface: strOrNull(r.mesh_iface),
    stale: r.stale === true,
  };
}

/** Per-relay fragment counters on the receiver; `relays` is null when stale. */
export async function getWfbReceiverRelays(
  ctx: RequestContext,
): Promise<WfbReceiverRelays> {
  const r = await gsRequest<Raw>(ctx, "/api/v1/ground-station/wfb/receiver/relays");
  const stale = r.stale === true;
  return {
    relays: !stale && Array.isArray(r.relays) ? (r.relays as WfbReceiverRelay[]) : null,
    stale,
  };
}

/** Combined FEC output stats on the receiver; every counter is null when stale. */
export async function getWfbReceiverCombined(
  ctx: RequestContext,
): Promise<WfbReceiverCombined> {
  const r = await gsRequest<Raw>(ctx, "/api/v1/ground-station/wfb/receiver/combined");
  return {
    fragments_after_dedup: numOrNull(r.fragments_after_dedup),
    fec_repaired: numOrNull(r.fec_repaired),
    output_kbps: numOrNull(r.output_kbps),
    up: boolOrNull(r.up),
    stale: r.stale === true,
  };
}

// ─── v0.16 pair surface ─────────────────────────────────────────
// All four routes are role-agnostic: the agent infers `drone` vs `gs`
// from its own profile and runs the matching half of the bind
// protocol. Direct REST against the agent's own listener (LAN, USB
// tether, or Cloudflare tunnel) — no Convex hop needed.

/** The agent holds the local-bind request open for up to 300 s before it
 *  cancels the rendezvous and answers with the terminal session; the client
 *  waits past that so the agent's own verdict always arrives. */
export const LOCAL_BIND_TIMEOUT_MS = 310_000;

/** Open a local-radio bind window. Synchronous: the agent runs the
 *  upstream wfb-ng protocol to completion and returns the terminal
 *  session shape (paired / failed / aborted), holding the request open for
 *  up to 300 s. HTTP 409 if a session is already in flight. */
export function openLocalBind(
  ctx: RequestContext,
  options: { role?: "drone" | "gs"; peer_device_id?: string } = {},
): Promise<LocalBindSession> {
  return gsRequest<LocalBindSession>(
    ctx,
    "/api/wfb/pair/local-bind",
    { method: "POST", body: JSON.stringify(options) },
    LOCAL_BIND_TIMEOUT_MS,
  );
}

/** Snapshot of the most recent bind session, or `{}` if none has run. */
export function getLocalBindStatus(
  ctx: RequestContext,
): Promise<LocalBindSession | Record<string, never>> {
  return gsRequest(ctx, "/api/wfb/pair/local-bind");
}

/** Pair-state snapshot: paired flag, peer device-id, fingerprint, role,
 *  auto-pair flag. Polled by the GCS card to drive the status pill. */
export function getPairStatus(
  ctx: RequestContext,
): Promise<PairStatusResponse> {
  return gsRequest<PairStatusResponse>(ctx, "/api/wfb/pair");
}

/** Wipe both key files, clear pair state, restart the wfb service.
 *  Leaves auto_pair_enabled = false; re-arming is explicit. */
export function unpairRadio(
  ctx: RequestContext,
): Promise<{ paired: false; role: "drone" | "gs" }> {
  return gsRequest(ctx, "/api/wfb/pair/unpair", {
    method: "POST",
  });
}

/** Toggle auto-pair on first boot. Re-arming is rejected (with a flag,
 *  not a 4xx) when already paired; operators must `unpairRadio` first. */
export function setAutoPair(
  ctx: RequestContext,
  enabled: boolean,
): Promise<AutoPairToggleResponse> {
  return gsRequest<AutoPairToggleResponse>(ctx, "/api/wfb/pair/auto-pair", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}
