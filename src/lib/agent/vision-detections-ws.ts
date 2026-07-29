/**
 * @module VisionDetectionsWs
 * @description Live detection feed for one drone. Opens a WebSocket to the
 * paired drone's agent (`/api/vision/detections/ws`), parses each
 * `DetectionBatch` the engine publishes, and pushes it into the
 * vision-detections store via `setBatch` so the overlay draws live boxes.
 *
 * The agent forwards the engine's detection-batch broadcast socket as JSON
 * with the contract's own field names (snake_case). This client maps those
 * onto the store's camelCase shape and reuses the LAN agent base URL +
 * `X-ADOS-Key` resolution that the rest of the agent surface uses (a one-shot
 * WebSocket ticket is minted under the hood, so the pairing key never reaches
 * the URL).
 *
 * Local-first: this is the LAN path (browser → agent over the same network).
 * The cloud-relay path for a remote drone (a vision/detection MQTT topic via
 * `ados-cloud`) is a documented follow-up; when it lands it feeds the same
 * `setBatch`, so this module does not change.
 *
 * @license GPL-3.0-only
 */

import { subscribeWebSocket } from "@/lib/api/ground-station/ws";
import { CONTRACT_VERSIONS } from "@/lib/plugins/contracts.generated";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import type {
  DetectionKeypoint,
  LockState,
  VisionDetection,
  VisionDetectionBatch,
} from "@/stores/vision-detections-store";

/** The agent's video pipeline normalizes frames to this default before the
 * engine runs inference. Detection coordinates are expressed in the normalized
 * frame, so the overlay scales boxes against these dimensions when the wire
 * batch does not carry explicit frame dimensions. Matches the agent's
 * `vision.downscale_width` / `downscale_height` defaults. */
const DEFAULT_FRAME_WIDTH = 640;
const DEFAULT_FRAME_HEIGHT = 480;

/** The detection-batch wire version this GCS speaks. The agent stamps `v` on
 * every batch (`ados_protocol::framebus::VISION_DETECTION_VERSION`) and rejects
 * a version it does not speak; the GCS mirrors that contract. A batch whose `v`
 * is present but does NOT equal this is DROPPED rather than mis-mapped onto a
 * shape a newer version may have reshaped under us (Rule 44 — never present
 * garbage as data). A batch with no `v` (an agent predating the field, or a
 * transport that omits it) maps normally, preserving back-compat. Sourced from
 * the generated contract registry so it never drifts from the agent's stamp. */
const SUPPORTED_DETECTION_VERSION = CONTRACT_VERSIONS["vision.detection"];

/** One detection as it arrives on the wire (contract field names). The box and
 * the richer percept fields are all optional so batches from an agent that
 * predates them — or a box-less percept (a mask/pose/depth-only reading) — map
 * cleanly. */
interface WireDetection {
  bbox?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  class_label?: unknown;
  confidence?: unknown;
  track_id?: unknown;
  assoc_confidence?: unknown;
  lock_state?: unknown;
  attributes?: unknown;
  mask?: unknown;
  keypoints?: unknown;
  depth?: unknown;
  world_pos?: unknown;
}

/** A detection batch as the agent forwards it (contract field names). A
 * future agent may add `frame_width` / `frame_height`; both are read
 * optionally so the overlay can scale precisely when they are present. */
export interface WireDetectionBatch {
  /** Wire schema version the agent stamps on the batch (see
   * {@link SUPPORTED_DETECTION_VERSION}). Optional so batches from an agent that
   * predates it still map. */
  v?: unknown;
  model_id?: unknown;
  camera_id?: unknown;
  frame_id?: unknown;
  ts_ms?: unknown;
  frame_width?: unknown;
  frame_height?: unknown;
  detections?: unknown;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function lockState(v: unknown): LockState | null {
  return v === "locked" || v === "uncertain" || v === "lost" ? v : null;
}

function numOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Parse a wire segmentation mask (a polygon of `[x, y]` pairs). */
function maskPolygon(v: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.flatMap((pt) =>
    Array.isArray(pt) && pt.length >= 2
      ? [[num(pt[0]), num(pt[1])] as [number, number]]
      : [],
  );
}

/** Parse a wire keypoint list (`{x, y, confidence}` per point). */
function keypointList(v: unknown): DetectionKeypoint[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.flatMap((kp) => {
    if (!kp || typeof kp !== "object") return [];
    const r = kp as Record<string, unknown>;
    return [{ x: num(r.x), y: num(r.y), confidence: num(r.confidence) }];
  });
}

/** Parse a wire world position (`[x, y, z]`). */
function worldPos(v: unknown): [number, number, number] | undefined {
  return Array.isArray(v) && v.length >= 3
    ? [num(v[0]), num(v[1]), num(v[2])]
    : undefined;
}

function mapDetection(raw: WireDetection): VisionDetection {
  const b = raw.bbox ?? {};
  const trackId =
    typeof raw.track_id === "number" && Number.isFinite(raw.track_id)
      ? raw.track_id
      : null;
  const assocConfidence =
    typeof raw.assoc_confidence === "number" &&
    Number.isFinite(raw.assoc_confidence)
      ? raw.assoc_confidence
      : null;
  return {
    // Absent for a box-less percept (a mask/pose/depth-only reading); a box
    // detector always sends it.
    bbox:
      raw.bbox != null && typeof raw.bbox === "object"
        ? {
            x: num(b.x),
            y: num(b.y),
            width: num(b.width),
            height: num(b.height),
          }
        : undefined,
    classLabel: str(raw.class_label),
    confidence: num(raw.confidence),
    trackId,
    assocConfidence,
    lockState: lockState(raw.lock_state),
    attributes:
      raw.attributes && typeof raw.attributes === "object"
        ? (raw.attributes as Record<string, unknown>)
        : null,
    mask: maskPolygon(raw.mask),
    keypoints: keypointList(raw.keypoints),
    depth: numOrUndefined(raw.depth),
    worldPos: worldPos(raw.world_pos),
  };
}

/** Map a wire batch onto the store's camelCase shape (minus `receivedAt`,
 * which the store stamps). Frame dimensions default to the engine's
 * normalized size unless the agent advertised them. */
export function mapWireBatch(
  raw: WireDetectionBatch,
): Omit<VisionDetectionBatch, "receivedAt"> | null {
  // Drop a batch whose wire version is present but not the one we speak: a newer
  // version may reshape fields, so mapping it would silently produce garbage.
  // An absent `v` predates the field and maps normally (back-compat).
  if (raw.v !== undefined && raw.v !== SUPPORTED_DETECTION_VERSION) {
    return null;
  }
  const detections = Array.isArray(raw.detections)
    ? raw.detections.flatMap((d) =>
        d && typeof d === "object" ? [mapDetection(d as WireDetection)] : [],
      )
    : [];
  const frameWidth = num(raw.frame_width) || DEFAULT_FRAME_WIDTH;
  const frameHeight = num(raw.frame_height) || DEFAULT_FRAME_HEIGHT;
  return {
    modelId: str(raw.model_id),
    cameraId: str(raw.camera_id),
    frameId: num(raw.frame_id),
    tsMs: num(raw.ts_ms),
    frameWidth,
    frameHeight,
    detections,
  };
}

/**
 * Parse a detection-batch JSON string (the contract's snake_case shape, the
 * same one the LAN WebSocket forwards) into the store's camelCase batch, or
 * `null` when the text is malformed / not an object. The cloud-relay MQTT path
 * (`ados/{deviceId}/vision/detections`) reuses this so a cloud batch maps
 * IDENTICALLY to a LAN batch and feeds the same `setBatch`. Malformed payloads
 * are dropped (returns null), never thrown.
 */
export function parseWireDetectionJson(
  text: string,
): Omit<VisionDetectionBatch, "receivedAt"> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return mapWireBatch(raw as WireDetectionBatch);
}

export interface VisionDetectionsConnection {
  /** Close the WebSocket and stop feeding the store. Also clears the
   * drone's batch so a stale box set does not linger after disconnect. */
  close: () => void;
}

export interface ConnectVisionDetectionsOptions {
  /** Drone/device id the batches are stored under (the overlay key). */
  droneId: string;
  /** LAN base URL of the drone's agent (e.g. `http://drone.local:8080`). */
  agentUrl: string;
  /** Pairing key for the agent, or null for an unpaired (open) agent. */
  apiKey: string | null;
  /** Optional connection-state callback for surfacing link health. */
  onState?: (state: "connected" | "reconnecting" | "closed") => void;
}

/**
 * Open the live-detection WebSocket for one drone and feed the store. Returns
 * a handle whose `close()` tears the socket down and clears the drone's batch.
 * A null/empty `agentUrl` means there is no LAN path (cloud-only session): the
 * function is a no-op that returns a closeable handle so callers do not branch.
 */
export function connectVisionDetections(
  opts: ConnectVisionDetectionsOptions,
): VisionDetectionsConnection {
  const { droneId, agentUrl, apiKey, onState } = opts;
  if (!agentUrl) {
    return { close: () => {} };
  }

  const setBatch = useVisionDetectionsStore.getState().setBatch;
  const clearBatch = useVisionDetectionsStore.getState().clearBatch;

  const unsubscribe = subscribeWebSocket<WireDetectionBatch>({
    ctx: { baseUrl: agentUrl, apiKey },
    path: "/api/vision/detections/ws",
    scope: "vision.detections",
    onEvent: (raw) => {
      const mapped = mapWireBatch(raw);
      // A version this GCS does not speak maps to null — skip it, never feed
      // the store a mis-mapped batch.
      if (mapped) setBatch(droneId, mapped);
    },
    onState,
  });

  return {
    close: () => {
      unsubscribe();
      clearBatch(droneId);
    },
  };
}
