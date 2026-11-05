// WFB-ng radio config plus distributed receive (relay and receiver) status.

import type {
  AutoPairToggleResponse,
  LocalBindSession,
  PairRequest,
  PairResult,
  PairStatusResponse,
  SetTxPowerResult,
  UnpairResult,
  VideoConfigResponse,
  PhoneInviteDecision,
  PhoneInviteList,
  WfbConfig,
  WfbReceiverCombined,
  WfbReceiverRelay,
  WfbReceiverRelays,
  WfbRelayStatus,
} from "./types";
import { gsRequest, type RequestContext } from "./request";
import { withForceQuery, type ArmedOverrideOptions } from "@/lib/agent/agent-client/transport";

/** Operator-facing radio link presets the agent maps to an (mcs, fec) trio. */
export type LinkPreset = "conservative" | "balanced" | "aggressive";

export function getWfb(ctx: RequestContext): Promise<WfbConfig> {
  return gsRequest<WfbConfig>(ctx, "/api/v1/ground-station/wfb");
}

/** Set the requested TX power in dBm. The agent clamps to the active
 *  driver's maximum and returns the effective value alongside the cap. */
export function setTxPower(
  ctx: RequestContext,
  dbm: number,
  opts?: ArmedOverrideOptions,
): Promise<SetTxPowerResult> {
  return gsRequest<SetTxPowerResult>(ctx, "/api/wfb/tx-power", {
    method: "PUT",
    body: JSON.stringify(opts?.force ? { tx_power_dbm: dbm, force: true } : { tx_power_dbm: dbm }),
  });
}

// ─── Radio link tuning ──────────────────────────────────────────
// These drive the drone agent's POST /api/video/config route (the agent
// applies the knob to the live data plane and persists it). Each returns the
// agent's response with a `warnings` array so a partial apply is visible. The
// card reads the resulting live values back from the per-drone radio snapshot.
// The agent refuses a knob while the vehicle is armed (409 `E_ARMED`, thrown
// as `AgentArmedRefusal`); the caller resends it with `force` only after the
// operator confirms (`useArmedOverrideConfirm`).

/** A link-tuning body, carrying the armed override when the operator chose it. */
export function linkTuningBody(knobs: Record<string, unknown>, opts?: ArmedOverrideOptions): string {
  return JSON.stringify(opts?.force ? { ...knobs, force: true } : knobs);
}

/** Set the Reed-Solomon FEC ratio (k data shards, n total). Requires n > k. */
export function setFec(
  ctx: RequestContext,
  fecK: number,
  fecN: number,
  opts?: ArmedOverrideOptions,
): Promise<VideoConfigResponse> {
  return gsRequest<VideoConfigResponse>(ctx, "/api/video/config", {
    method: "POST",
    body: linkTuningBody({ fec_k: fecK, fec_n: fecN }, opts),
  });
}

/** Set the 802.11 MCS index (0-7) the transmitter sends at. */
export function setMcs(
  ctx: RequestContext,
  mcs: number,
  opts?: ArmedOverrideOptions,
): Promise<VideoConfigResponse> {
  return gsRequest<VideoConfigResponse>(ctx, "/api/video/config", {
    method: "POST",
    body: linkTuningBody({ mcs }, opts),
  });
}

/** Apply a named link preset (sets the base rate + redundancy trio). */
export function setPreset(
  ctx: RequestContext,
  preset: LinkPreset,
  opts?: ArmedOverrideOptions,
): Promise<VideoConfigResponse> {
  return gsRequest<VideoConfigResponse>(ctx, "/api/video/config", {
    method: "POST",
    body: linkTuningBody({ preset }, opts),
  });
}

/** Arm (true) or disarm (false) the closed-loop adaptive FEC controller. */
export function setAdaptive(
  ctx: RequestContext,
  enabled: boolean,
  opts?: ArmedOverrideOptions,
): Promise<VideoConfigResponse> {
  return gsRequest<VideoConfigResponse>(ctx, "/api/video/config", {
    method: "POST",
    body: linkTuningBody({ auto: enabled }, opts),
  });
}

/** The `POST .../wfb/pair` body. Whitespace is stripped from each key so a
 *  wrapped or line-broken paste decodes on the agent; an empty shared key is
 *  left out, which the agent reads as "the radio bind distributes it". */
export function pairRequestBody(
  blobB64: string,
  droneDeviceId: string,
  sharedKeyB64?: string,
): PairRequest {
  const body: PairRequest = {
    blob_b64: blobB64.replace(/\s+/g, ""),
    drone_device_id: droneDeviceId.trim(),
  };
  const shared = sharedKeyB64?.replace(/\s+/g, "");
  if (shared) body.shared_key_b64 = shared;
  return body;
}

/** Install the drone's fleet key on this ground station and take a fleet slot
 *  for `droneDeviceId`. A second drone presenting the same key joins the fleet.
 *  `sharedKeyB64` is the drone's half of the pair, which the station's beacon
 *  key is derived from. */
export function pairDrone(
  ctx: RequestContext,
  blobB64: string,
  droneDeviceId: string,
  sharedKeyB64?: string,
): Promise<PairResult> {
  return gsRequest<PairResult>(ctx, "/api/v1/ground-station/wfb/pair", {
    method: "POST",
    body: JSON.stringify(pairRequestBody(blobB64, droneDeviceId, sharedKeyB64)),
  });
}

export function unpairDrone(
  ctx: RequestContext,
  opts?: ArmedOverrideOptions,
): Promise<UnpairResult> {
  return gsRequest<UnpairResult>(ctx, withForceQuery("/api/v1/ground-station/wfb/pair", opts), {
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
  opts?: ArmedOverrideOptions,
): Promise<{ paired: false; role: "drone" | "gs" }> {
  return gsRequest(ctx, withForceQuery("/api/wfb/pair/unpair", opts), {
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

// ─── Phone receivers ────────────────────────────────────────────
// A phone with its own radio asks the ground station for the fleet receive
// keys; nothing is shared until an operator approves it here.

/** The phone receivers waiting for approval. */
export function listPhoneInvites(ctx: RequestContext): Promise<PhoneInviteList> {
  return gsRequest<PhoneInviteList>(ctx, "/api/v1/ground-station/wfb/invite");
}

/** Approve or reject one waiting phone receiver. */
export function decidePhoneInvite(
  ctx: RequestContext,
  inviteId: string,
  decision: "approve" | "reject",
): Promise<PhoneInviteDecision> {
  return gsRequest<PhoneInviteDecision>(
    ctx,
    `/api/v1/ground-station/wfb/invite/${encodeURIComponent(inviteId)}/${decision}`,
    { method: "POST" },
  );
}
