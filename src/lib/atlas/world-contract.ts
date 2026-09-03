/**
 * @module lib/atlas/world-contract
 * @description The GCS half of the Drone Agent's Atlas wire contract: the topic
 * names, the shared-data capability gate, the bearer keyframe rule, and the
 * framed `AtlasEvent` envelope decoder.
 *
 * Mirrored from `ADOSDroneAgent/crates/ados-protocol/src/atlas.rs`, which is the
 * single authority for every constant here. The envelope version is NOT
 * hand-copied — it is read from the generated contract registry
 * (`CONTRACT_VERSIONS["atlas.envelope"]`), so an agent-side version bump reaches
 * this decoder through codegen instead of through someone remembering.
 *
 * The agent's own decoder gates the whole contract on the envelope: a frame
 * whose `v` this build does not speak is rejected before its payload is read,
 * because mis-parsing a payload against the wrong schema is worse than dropping
 * it. This mirrors that, and reports WHICH version was refused so an operator
 * surface can say "this build speaks 1, the node sent 2" rather than
 * "malformed".
 *
 * @license GPL-3.0-only
 */

import { CONTRACT_VERSIONS } from "@/lib/plugins/contracts.generated";
import { asMsgpackMap, decodeMsgpack, MsgpackError } from "./msgpack";

// --- Topics ----------------------------------------------------------------

/** Capture-session state (state, keyframe counts, VIO health). */
export const ATLAS_CAPTURE_STATE_TOPIC = "atlas.capture.state";
/** A selected pose-tagged keyframe, emitted drone-to-compute. */
export const ATLAS_KEYFRAME_TOPIC = "atlas.keyframe";
/** The offloaded-pose return leg, compute-to-drone. */
export const ATLAS_POSE_OFFLOAD_TOPIC = "atlas.pose.offload";

/** Shared-data: current 6-DoF pose plus world anchor (~10 Hz). */
export const PLUGIN_ATLAS_POSE_TOPIC = "plugin.atlas.pose";
/** Shared-data: point-cloud descriptor. */
export const PLUGIN_ATLAS_POINTCLOUD_TOPIC = "plugin.atlas.pointcloud";
/** Shared-data: occupancy / ESDF grid descriptor. */
export const PLUGIN_ATLAS_OCCUPANCY_TOPIC = "plugin.atlas.occupancy";
/** Shared-data: gaussian-splat descriptor. */
export const PLUGIN_ATLAS_SPLAT_TOPIC = "plugin.atlas.splat";
/** Shared-data: mesh descriptor. */
export const PLUGIN_ATLAS_MESH_TOPIC = "plugin.atlas.mesh";

/** Every shared-data world-model topic, so a consumer iterates the set rather
 * than hard-coding five literals that drift from the agent's own list. */
export const PLUGIN_ATLAS_TOPICS = [
  PLUGIN_ATLAS_POSE_TOPIC,
  PLUGIN_ATLAS_POINTCLOUD_TOPIC,
  PLUGIN_ATLAS_OCCUPANCY_TOPIC,
  PLUGIN_ATLAS_SPLAT_TOPIC,
  PLUGIN_ATLAS_MESH_TOPIC,
] as const;

/** The four ARTIFACT topics — the world model proper, excluding the live pose
 * lane, which is telemetry rather than an artifact. */
export const PLUGIN_ATLAS_ARTIFACT_TOPICS = [
  PLUGIN_ATLAS_SPLAT_TOPIC,
  PLUGIN_ATLAS_POINTCLOUD_TOPIC,
  PLUGIN_ATLAS_MESH_TOPIC,
  PLUGIN_ATLAS_OCCUPANCY_TOPIC,
] as const;

// --- Shared-data access policy --------------------------------------------

/** The capability gating the world-model artifact descriptors. A descriptor
 * names where a reconstruction of the flown area can be fetched, which is what
 * "read compute-node job status and results" already covers. */
export const ATLAS_WORLD_READ_CAP = "compute.job.read";

/** The capability gating the live ~10 Hz world pose — the same class of data as
 * the vehicle telemetry a consumer already reads, in the world frame. */
export const ATLAS_POSE_READ_CAP = "telemetry.read";

/**
 * The capability required to subscribe to `topic`, or null when `topic` is not a
 * world-model shared-data topic.
 *
 * **Exact match, never a prefix.** `plugin.atlas.occupancy.evil` resolves to
 * null so it inherits nothing from `plugin.atlas.occupancy`; a prefix match
 * would let a caller mint a topic under a gated prefix and be handed that
 * prefix's capability, which turns the gate into a naming convention.
 */
export function atlasTopicSubscribeCapability(topic: string): string | null {
  if (topic === PLUGIN_ATLAS_POSE_TOPIC) return ATLAS_POSE_READ_CAP;
  if (
    topic === PLUGIN_ATLAS_POINTCLOUD_TOPIC ||
    topic === PLUGIN_ATLAS_OCCUPANCY_TOPIC ||
    topic === PLUGIN_ATLAS_SPLAT_TOPIC ||
    topic === PLUGIN_ATLAS_MESH_TOPIC
  ) {
    return ATLAS_WORLD_READ_CAP;
  }
  return null;
}

// --- Bearer rule -----------------------------------------------------------

/**
 * Whether a bearer can carry a full keyframe, from the bearer name the
 * forwarder reports (`direct-lan` / `wfb-relay` / `cloud`).
 *
 * A pure property of the bearer, not a runtime measurement: the WFB relay's
 * datagram ceiling is 1300 bytes against a multi-MB JPEG keyframe, so a no-LAN
 * field topology degrades to pose and status only — i.e. NO world model — while
 * the operator surface would otherwise report `bearer: "wfb-relay"` as though
 * the lane were working.
 */
export function bearerCarriesKeyframes(bearer: string): boolean {
  return bearer !== "wfb-relay";
}

/** True when the bearer cannot carry keyframes, so the world-model lane is
 * degraded to pose and status. The operator-facing wording is a locale string
 * on this side rather than the agent's verbatim English. */
export function bearerKeyframesDegraded(bearer: string | null): boolean {
  return bearer !== null && !bearerCarriesKeyframes(bearer);
}

// --- Envelope --------------------------------------------------------------

/** The on-wire envelope version this build speaks, from generated codegen. */
export const ATLAS_ENVELOPE_VERSION = CONTRACT_VERSIONS["atlas.envelope"];

/** One framed message off the atlas bus / world-descriptor stream. */
export interface AtlasEvent {
  /** Envelope version, always {@link ATLAS_ENVELOPE_VERSION} once decoded. */
  v: number;
  topic: string;
  /** The capturing drone's device id, stamped by the drone-side forwarder on
   * egress. Null on a local-bus event that never left the drone. */
  deviceId: string | null;
  /** The topic's own msgpack-encoded struct, still undecoded. */
  payload: Uint8Array;
}

/** Why an envelope was refused. Distinct reasons because they mean different
 * things to an operator: `version` is a build/agent mismatch to act on, while
 * `malformed` is a corrupt or non-contract frame. */
export type AtlasEventRejection = "malformed" | "shape" | "version";

export type AtlasEventDecodeResult =
  | { ok: true; event: AtlasEvent }
  | {
      ok: false;
      reason: AtlasEventRejection;
      detail: string;
      /** The refused envelope version, when the frame decoded far enough to
       * carry one. */
      version: number | null;
    };

/** `Vec<u8>` crosses as a msgpack array of integers (see the msgpack module),
 * so the payload is rebuilt from that array. A `bin` payload is also accepted
 * so a producer that later adopts `serde_bytes` needs no change here. */
function payloadBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (!Array.isArray(value)) return null;
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const b = value[i];
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 255) {
      return null;
    }
    out[i] = b;
  }
  return out;
}

/**
 * Decode a framed `AtlasEvent`, refusing a frame whose envelope version this
 * build does not speak before its payload is touched.
 *
 * Returns a result rather than throwing: the stream consumer counts refusals by
 * reason and keeps streaming, exactly as the agent's own fan-out skips a lagged
 * descriptor instead of stalling the trainer.
 */
export function decodeAtlasEvent(bytes: Uint8Array): AtlasEventDecodeResult {
  let map: { [key: string]: unknown } | null;
  try {
    map = asMsgpackMap(decodeMsgpack(bytes));
  } catch (err) {
    return {
      ok: false,
      reason: "malformed",
      detail: err instanceof MsgpackError ? err.message : String(err),
      version: null,
    };
  }
  if (!map) {
    return {
      ok: false,
      reason: "shape",
      detail: "envelope is not a msgpack map",
      version: null,
    };
  }

  // The version field rides as `v` and carries no serde default, so a frame
  // without it is not an envelope at all.
  const v = map.v;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return {
      ok: false,
      reason: "shape",
      detail: "envelope carries no integer version field",
      version: null,
    };
  }
  if (v !== ATLAS_ENVELOPE_VERSION) {
    return {
      ok: false,
      reason: "version",
      detail: `unsupported atlas envelope version ${v} (this build speaks ${ATLAS_ENVELOPE_VERSION})`,
      version: v,
    };
  }

  const topic = map.topic;
  if (typeof topic !== "string" || topic.length === 0) {
    return {
      ok: false,
      reason: "shape",
      detail: "envelope carries no topic",
      version: v,
    };
  }
  const payload = payloadBytes(map.payload);
  if (!payload) {
    return {
      ok: false,
      reason: "shape",
      detail: "envelope payload is not a byte sequence",
      version: v,
    };
  }
  const deviceId = map.device_id;
  return {
    ok: true,
    event: {
      v,
      topic,
      deviceId: typeof deviceId === "string" && deviceId.length > 0 ? deviceId : null,
      payload,
    },
  };
}
