/**
 * @module agent/agent-client/extras
 * @description Per-domain method bundles for the agent REST client:
 * peripherals, fleet, video, recordings, pairing, and MAVLink signing.
 * Each function takes a `RequestContext` so the AgentClient class
 * re-exposes them as instance methods without embedding the network
 * details in the class body.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import type {
  ClaimResponse,
  NetworkPeer,
  PairingInfo,
  PeripheralInfo,
  VideoStatus,
} from "../types";
import {
  ClaimResponseSchema,
  NetworkPeerListSchema,
  PairingInfoSchema,
  PeripheralListSchema,
  VideoStatusSchema,
} from "../schemas";
import {
  AgentArmedRefusal,
  AgentHttpError,
  agentRequest,
  type ArmedOverrideOptions,
  type RequestContext,
} from "./transport";
import type {
  CameraListResponse,
  RecordingControlResponse,
  RecordingListResponse,
  SigningCapability,
  SigningCounters,
  SigningDisableResult,
  SigningEnrollResult,
} from "./types";

// ── Peripherals ───────────────────────────────────────────────

export function getPeripherals(ctx: RequestContext): Promise<PeripheralInfo[]> {
  return agentRequest<PeripheralInfo[]>(ctx, "/api/peripherals", {
    schema: PeripheralListSchema as z.ZodType<PeripheralInfo[]>,
    allowSchemaFallback: true,
  });
}

export function scanPeripherals(ctx: RequestContext): Promise<PeripheralInfo[]> {
  return agentRequest<PeripheralInfo[]>(ctx, "/api/peripherals/scan", {
    method: "POST",
    schema: PeripheralListSchema as z.ZodType<PeripheralInfo[]>,
    allowSchemaFallback: true,
  });
}

// ── Fleet ─────────────────────────────────────────────────────

export function getPeers(ctx: RequestContext): Promise<NetworkPeer[]> {
  return agentRequest<NetworkPeer[]>(ctx, "/api/fleet/peers", {
    schema: NetworkPeerListSchema as z.ZodType<NetworkPeer[]>,
    allowSchemaFallback: true,
  });
}

// ── Video ─────────────────────────────────────────────────────

export async function getVideoStatus(
  ctx: RequestContext,
): Promise<VideoStatus | null> {
  try {
    return await agentRequest<VideoStatus>(ctx, "/api/video", {
      schema: VideoStatusSchema as z.ZodType<VideoStatus>,
      allowSchemaFallback: true,
    });
  } catch {
    return null; // Agent may not support this endpoint
  }
}

/** Enumerate cameras the agent has detected, plus the current
 * primary/secondary role assignments. Returns an empty list shape
 * when the agent has no video pipeline yet. */
export function listCameras(ctx: RequestContext): Promise<CameraListResponse> {
  return agentRequest<CameraListResponse>(ctx, "/api/video/cameras");
}

/** Live snapshot of the adaptive bitrate / FEC / radio config. */
export async function getVideoConfig(
  ctx: RequestContext,
): Promise<unknown | null> {
  try {
    return await agentRequest<unknown>(ctx, "/api/video/config");
  } catch {
    return null;
  }
}

/** Apply zero or more video / radio tuning knobs. A radio knob is refused
 * while the vehicle is armed: that refusal is rethrown as `AgentArmedRefusal`
 * so the caller can ask the operator and resend with `force`; any other
 * failure reads as null. */
export async function setVideoConfig(
  ctx: RequestContext,
  body: Partial<{
    bitrate_kbps: number;
    fec_k: number;
    fec_n: number;
    mcs: number;
    auto: boolean;
    tier_idx: number;
  }>,
  opts?: ArmedOverrideOptions,
): Promise<unknown | null> {
  try {
    return await agentRequest<unknown>(ctx, "/api/video/config", {
      method: "POST",
      body: JSON.stringify(opts?.force ? { ...body, force: true } : body),
    });
  } catch (err) {
    if (err instanceof AgentArmedRefusal) throw err;
    return null;
  }
}

/** Glass-to-glass video latency reading sourced from the SEI
 * probe on the drone-side LocalVideoTap. */
export async function getVideoLatency(
  ctx: RequestContext,
): Promise<unknown | null> {
  try {
    return await agentRequest<unknown>(ctx, "/api/video/latency");
  } catch {
    return null;
  }
}

/** A drone's video attention profile: `hero` runs the camera's full encoder
 * settings, `thumbnail` the 1 fps share every non-hero drone of a WFB fleet
 * streams. */
export type VideoAttentionProfile = "hero" | "thumbnail";

/** One live hold on the hero profile. `expires_in_s` is null for an agent-internal
 * hold (a vision engine attached to the tap). */
export interface VideoProfileLease {
  holder: string;
  expires_in_s: number | null;
}

/** The encoder state every `/api/video/profile` verb answers with. `profile`
 * is the effective one: hero while any lease is live, else `base_profile`.
 * The lease fields are absent on an agent that predates profile leases. */
export interface VideoProfileApplied {
  profile: VideoAttentionProfile;
  base_profile?: VideoAttentionProfile;
  width: number;
  height: number;
  fps: number;
  bitrate_kbps: number;
  /** The adaptive ladder's clamp; null when unclamped. */
  ceiling_kbps: number | null;
  leases?: VideoProfileLease[];
}

/** A hero lease request: `holder` is 1-64 chars of `[A-Za-z0-9._:-]`,
 * `leaseS` 5-120 s. The holder renews by sending the same request again. */
export interface VideoProfileLeaseRequest {
  holder: string;
  leaseS: number;
}

/** Agent's encoder-socket client bound (10 s) plus margin: a profile switch
 * respawns the encoder and the route answers only once it is applied. */
const VIDEO_PROFILE_TIMEOUT_MS = 12_000;

/** Set the drone's video attention profile (`POST /api/video/profile`). With
 * `lease`, a `hero` request takes or renews that holder's lease instead of
 * changing the base profile. A ground station answers 404 and a rig with no
 * video pipeline 503. */
export function setVideoProfile(
  ctx: RequestContext,
  profile: VideoAttentionProfile,
  lease?: VideoProfileLeaseRequest,
): Promise<VideoProfileApplied> {
  const body = lease
    ? { profile, holder: lease.holder, lease_s: lease.leaseS }
    : { profile };
  return agentRequest<VideoProfileApplied>(ctx, "/api/video/profile", {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: VIDEO_PROFILE_TIMEOUT_MS,
  });
}

/** Release one holder's hero lease (`DELETE /api/video/profile?holder=`).
 * Idempotent: an unknown holder still answers 200. */
export function releaseVideoProfile(
  ctx: RequestContext,
  holder: string,
): Promise<VideoProfileApplied> {
  return agentRequest<VideoProfileApplied>(
    ctx,
    `/api/video/profile?holder=${encodeURIComponent(holder)}`,
    { method: "DELETE", timeoutMs: VIDEO_PROFILE_TIMEOUT_MS },
  );
}

/** Wall-clock + monotonic timestamps from the drone. */
export async function getTime(
  ctx: RequestContext,
): Promise<
  { time_ns: number; monotonic_ns: number; ntp_synced: boolean } | null
> {
  try {
    return await agentRequest<{
      time_ns: number;
      monotonic_ns: number;
      ntp_synced: boolean;
    }>(ctx, "/api/time");
  } catch {
    return null;
  }
}

// ── Recording ─────────────────────────────────────────────────

/** Start the ground station's recorder (`POST
 * /api/v1/ground-station/recording/start`). The recorder is the ground
 * station's own capture of the received feed; the drone profile has no HTTP
 * recorder (its `/api/video/record/*` routes answer 501, and this route 404s
 * off a ground station). The route parses a JSON body, so an empty object is
 * sent when there is no filename hint. A capture already running is a 409. */
export function startRecording(
  ctx: RequestContext,
): Promise<RecordingControlResponse> {
  return agentRequest<RecordingControlResponse>(
    ctx,
    "/api/v1/ground-station/recording/start",
    { method: "POST", body: "{}" },
  );
}

/** Stop the ground station's in-flight capture. No active capture is a 409. */
export function stopRecording(
  ctx: RequestContext,
): Promise<RecordingControlResponse> {
  return agentRequest<RecordingControlResponse>(
    ctx,
    "/api/v1/ground-station/recording/stop",
    { method: "POST" },
  );
}

/** List the ground station's recording files. A failure throws so the caller
 * can say the list could not be read instead of showing an empty, idle list. */
export function listRecordings(
  ctx: RequestContext,
): Promise<RecordingListResponse> {
  return agentRequest<RecordingListResponse>(
    ctx,
    "/api/v1/ground-station/recording/list",
  );
}

// ── Pairing ───────────────────────────────────────────────────

export function getPairingInfo(ctx: RequestContext): Promise<PairingInfo> {
  return agentRequest<PairingInfo>(ctx, "/api/pairing/info", {
    schema: PairingInfoSchema as z.ZodType<PairingInfo>,
  });
}

export function claimLocally(
  ctx: RequestContext,
  userId: string,
): Promise<ClaimResponse> {
  return agentRequest<ClaimResponse>(ctx, "/api/pairing/claim", {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
    schema: ClaimResponseSchema as z.ZodType<ClaimResponse>,
  });
}

// ── MAVLink signing ───────────────────────────────────────────
//
// The agent holds no key material. These endpoints cover capability
// detection, one-shot FC enrollment (key_hex zeroized after), FC
// clearing, and passive signed-frame counters.
//
// The two WRITES carry a 30 s deadline rather than the 6 s default.
// Enrollment sends SETUP_SIGNING twice with a deliberate 200 ms gap, over a
// link that may be a congested radio, and the agent only answers after the
// second send. Aborting at 6 s does not undo the first frame: the FC can end
// up enrolled while the GCS reports failure, which is the one outcome that
// locks the operator out of their own aircraft. Waiting is strictly safer
// than a premature abort here, and `SIGNING_WRITE_TIMEOUT_MS` still bounds it.
const SIGNING_WRITE_TIMEOUT_MS = 30_000;

export function getSigningCapability(
  ctx: RequestContext,
): Promise<SigningCapability> {
  return agentRequest<SigningCapability>(
    ctx,
    "/api/mavlink/signing/capability",
  );
}

/** The FC may already hold the new key: the agent sent the first
 * SETUP_SIGNING frame but the confirming repeat failed (HTTP 500 with
 * `partially_applied: true`). The caller must keep the key and verify the
 * signing state instead of discarding it. */
export class SigningPartialEnrollError extends Error {
  /** First 8 hex of sha256(key): a fingerprint, never the key. */
  readonly keyId: string | null;

  constructor(message: string, keyId: string | null) {
    super(message);
    this.name = "SigningPartialEnrollError";
    this.keyId = keyId;
  }
}

/** Enroll a signing key on the FC. With `agentHoldsKey` the node also keeps
 * the key so its own traffic (heartbeat, stream rates, param sweep, swarm
 * setpoints) is signed; that only takes effect where the node enables agent
 * signing. Throws `SigningPartialEnrollError` when the agent reports a
 * partially-applied enrollment; every other non-2xx answer stays an
 * `AgentHttpError`. */
export async function enrollSigningKey(
  ctx: RequestContext,
  keyHex: string,
  linkId: number,
  agentHoldsKey = false,
): Promise<SigningEnrollResult> {
  try {
    return await agentRequest<SigningEnrollResult>(
      ctx,
      "/api/mavlink/signing/enroll-fc",
      {
        method: "POST",
        body: JSON.stringify({
          key_hex: keyHex,
          link_id: linkId,
          agent_holds_key: agentHoldsKey,
        }),
        timeoutMs: SIGNING_WRITE_TIMEOUT_MS,
      },
    );
  } catch (err) {
    if (err instanceof AgentHttpError && err.status === 500) {
      let body: { detail?: unknown; partially_applied?: unknown; key_id?: unknown } = {};
      try {
        body = JSON.parse(err.body) as typeof body;
      } catch {
        /* not JSON: a plain enrollment failure */
      }
      if (body.partially_applied === true) {
        throw new SigningPartialEnrollError(
          typeof body.detail === "string" ? body.detail : "enrollment may have partially applied",
          typeof body.key_id === "string" ? body.key_id : null,
        );
      }
    }
    throw err;
  }
}

export function disableSigningOnFc(
  ctx: RequestContext,
): Promise<SigningDisableResult> {
  return agentRequest<SigningDisableResult>(
    ctx,
    "/api/mavlink/signing/disable-on-fc",
    { method: "POST", timeoutMs: SIGNING_WRITE_TIMEOUT_MS },
  );
}

export function getSigningCounters(
  ctx: RequestContext,
): Promise<SigningCounters> {
  return agentRequest<SigningCounters>(ctx, "/api/mavlink/signing/counters");
}
