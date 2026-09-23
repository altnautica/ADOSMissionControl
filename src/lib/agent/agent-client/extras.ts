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
  CommandResult,
  MeshNetEnrollment,
  NetworkPeer,
  PairingInfo,
  PeripheralInfo,
  VideoStatus,
} from "../types";
import {
  ClaimResponseSchema,
  CommandResultSchema,
  MeshNetEnrollmentSchema,
  NetworkPeerListSchema,
  PairingInfoSchema,
  PeripheralListSchema,
  VideoStatusSchema,
} from "../schemas";
import { AgentHttpError, agentRequest, type RequestContext } from "./transport";
import type {
  CameraListResponse,
  RecordingControlResponse,
  RecordingListResponse,
  SigningCapability,
  SigningCounters,
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

export function getEnrollment(ctx: RequestContext): Promise<MeshNetEnrollment> {
  return agentRequest<MeshNetEnrollment>(ctx, "/api/fleet/enrollment", {
    schema: MeshNetEnrollmentSchema as z.ZodType<MeshNetEnrollment>,
    allowSchemaFallback: true,
  });
}

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

/** Reassign a camera role (primary or secondary) to a specific
 * device path. The agent restarts the encoder before returning, so
 * callers should expect a brief gap in the live stream. */
export function switchCamera(
  ctx: RequestContext,
  role: "primary" | "secondary",
  devicePath: string,
): Promise<{ ok?: boolean; restarting?: boolean }> {
  return agentRequest<{ ok?: boolean; restarting?: boolean }>(
    ctx,
    "/api/video/camera/switch",
    {
      method: "POST",
      body: JSON.stringify({ role, device_path: devicePath }),
    },
  );
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

/** Apply zero or more video / radio tuning knobs. */
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
): Promise<unknown | null> {
  try {
    return await agentRequest<unknown>(ctx, "/api/video/config", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch {
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

/** Start recording on the agent. Drone profile uses `/api/video/record/start`;
 * ground-station profile uses the same shape under `/api/v1/ground-station/`.
 * The drone-profile route is picked here as the default; callers can branch
 * on the agent's profile when a ground-station-only deployment is in use. */
export function startRecording(
  ctx: RequestContext,
): Promise<RecordingControlResponse> {
  return agentRequest<RecordingControlResponse>(
    ctx,
    "/api/video/record/start",
    { method: "POST" },
  );
}

export function stopRecording(
  ctx: RequestContext,
): Promise<RecordingControlResponse> {
  return agentRequest<RecordingControlResponse>(
    ctx,
    "/api/video/record/stop",
    { method: "POST" },
  );
}

/** List recording files written to disk. The drone-profile video
 * pipeline does not currently expose a list endpoint, so this hits
 * the ground-station listing route. */
export async function listRecordings(
  ctx: RequestContext,
): Promise<RecordingListResponse> {
  try {
    return await agentRequest<RecordingListResponse>(
      ctx,
      "/api/v1/ground-station/recording/list",
    );
  } catch {
    return { recording: false, current_filename: null, items: [] };
  }
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

export function unpairAgent(ctx: RequestContext): Promise<CommandResult> {
  return agentRequest<CommandResult>(ctx, "/api/pairing/unpair", {
    method: "POST",
    schema: CommandResultSchema as z.ZodType<CommandResult>,
  });
}

// ── MAVLink signing ───────────────────────────────────────────
//
// The agent holds no key material. These endpoints cover capability
// detection, one-shot FC enrollment (key_hex zeroized after), FC
// clearing, SIGNING_REQUIRE toggle, and passive signed-frame counters.
//
// The three WRITES carry a 30 s deadline rather than the 6 s default.
// Enrollment and disable each send SETUP_SIGNING twice with a deliberate
// 200 ms gap, over a link that may be a congested radio, and the agent
// only answers after the second send. Aborting at 6 s does not undo the
// first frame: the FC can end up enrolled — or with signing REQUIRED —
// while the GCS reports failure, which is the one outcome that locks the
// operator out of their own aircraft. Waiting is strictly safer than a
// premature abort here, and `SIGNING_WRITE_TIMEOUT_MS` still bounds it.
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

/** Enroll a signing key on the FC. Throws `SigningPartialEnrollError` when
 * the agent reports a partially-applied enrollment; every other non-2xx
 * answer stays an `AgentHttpError`. */
export async function enrollSigningKey(
  ctx: RequestContext,
  keyHex: string,
  linkId: number,
): Promise<SigningEnrollResult> {
  try {
    return await agentRequest<SigningEnrollResult>(
      ctx,
      "/api/mavlink/signing/enroll-fc",
      {
        method: "POST",
        body: JSON.stringify({ key_hex: keyHex, link_id: linkId }),
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
): Promise<{ success: boolean }> {
  return agentRequest<{ success: boolean }>(
    ctx,
    "/api/mavlink/signing/disable-on-fc",
    { method: "POST", timeoutMs: SIGNING_WRITE_TIMEOUT_MS },
  );
}

export function getSigningRequire(
  ctx: RequestContext,
): Promise<{ require: boolean | null }> {
  return agentRequest<{ require: boolean | null }>(
    ctx,
    "/api/mavlink/signing/require",
  );
}

export function setSigningRequire(
  ctx: RequestContext,
  require: boolean,
): Promise<{ success: boolean; require: boolean }> {
  return agentRequest<{ success: boolean; require: boolean }>(
    ctx,
    "/api/mavlink/signing/require",
    {
      method: "PUT",
      body: JSON.stringify({ require }),
      timeoutMs: SIGNING_WRITE_TIMEOUT_MS,
    },
  );
}

export function getSigningCounters(
  ctx: RequestContext,
): Promise<SigningCounters> {
  return agentRequest<SigningCounters>(ctx, "/api/mavlink/signing/counters");
}
