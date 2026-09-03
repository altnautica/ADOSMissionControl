/**
 * @module VisionDetectionsStore
 * @description Per-drone store of the latest vision detection batch the
 * GCS knows about. The video overlay reads the active drone's batch and
 * draws bounding boxes scaled to the video element.
 *
 * A detection batch carries pixel-space boxes in the frame's own
 * resolution (origin top-left). Each batch declares its source frame
 * width/height so the overlay can map frame pixels onto the rendered
 * video rectangle regardless of the element's display size.
 *
 * TRANSPORT (live detections):
 *   The agent publishes detections on the `vision.detection` topic, and
 *   the engine re-broadcasts every per-frame `DetectionBatch` (model_id,
 *   camera_id, frame_id, ts_ms, detections[]) onto a Unix socket the
 *   agent's API process forwards to the browser over a WebSocket. The LAN
 *   client at `@/lib/agent/vision-detections-ws` opens that WebSocket for a
 *   paired drone, maps each batch onto the shape below, and calls
 *   `setBatch()`. A demo/test injector can also call `setBatch()` directly.
 *   The cloud-relay path for a remote drone (a vision/detection MQTT topic
 *   via `ados-cloud`) is a documented follow-up; it feeds the same
 *   `setBatch()`, so adding it stays purely additive.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import { RingBuffer } from "@/lib/ring-buffer";

/** Capacity of a drone's rolling receipt-timestamp window. Sized for a few
 * seconds of headroom even at a fast (~30 Hz) inference cadence, so the
 * throughput (batches/sec) readout never grows unbounded (Rule 3). */
const RATE_WINDOW_CAP = 128;

/**
 * Ceiling on concurrent detection STREAMS tracked per drone.
 *
 * A stream is keyed `modelId::cameraId`, both supplied by the agent's vision
 * engine, so the key space is open: a plugin that rotates model ids (a version
 * suffix, a per-run identifier) added a permanent entry per rotation and the
 * map only ever shrank on `clearBatch`. A rig runs a handful of pipelines; 32
 * is far past any real fan-out. When full, the stream whose last batch is
 * oldest is evicted — the ones actively producing survive.
 */
const MAX_STREAMS_PER_DRONE = 32;

/**
 * Insert `batch` under `key`, evicting the stalest stream once the per-drone
 * ceiling is reached.
 */
function withStream(
  streams: Record<string, VisionDetectionBatch>,
  key: string,
  batch: VisionDetectionBatch,
): Record<string, VisionDetectionBatch> {
  const next = { ...streams, [key]: batch };
  const keys = Object.keys(next);
  if (keys.length <= MAX_STREAMS_PER_DRONE) return next;
  let stalest = keys[0];
  for (const k of keys) {
    if (k !== key && next[k].receivedAt < next[stalest].receivedAt) stalest = k;
  }
  if (stalest !== key) delete next[stalest];
  return next;
}

/**
 * How long a detection batch stays "fresh" after it was received. Past this
 * age the overlay drops boxes and the perception health surfaces flip a live
 * feed to "stale / offload link lost" (distinct from "no targets"). Shared by
 * the cockpit overlay, the perception-health chip, and the what's-locked chip
 * so all three read the exact same freshness window (Rule 44 — one honest
 * source of truth for feed liveness).
 */
export const DETECTION_STALE_MS = 2000;

/** Pixel-space bounding box (origin top-left), in the frame's own
 * resolution. Mirrors the vision-contract `BoundingBox`. */
export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One keypoint of a detection (a pose joint or a landmark), in the frame's
 * own pixel resolution, with its own detection confidence. Mirrors the
 * vision-contract `Keypoint`. */
export interface DetectionKeypoint {
  x: number;
  y: number;
  confidence: number;
}

/** Discrete identity-lock state of a track this frame. Mirrors the
 * vision-contract `LockState` (lowercase string on the wire). `locked` = the
 * tracker is confident the identity held; `uncertain` = a weak association
 * (e.g. a box held on prediction through a miss) so the identity is
 * provisional; `lost` = the track could not be re-associated. Carrying it lets
 * the overlay show identity uncertainty instead of a silent swap. */
export type LockState = "locked" | "uncertain" | "lost";

/** One percept from a model. Mirrors the vision-contract `Detection`: a
 * self-describing unit that began as a 2D box and grows by adding typed
 * optional fields. The 2D `bbox` is itself optional — a box detector always
 * sets it, while a box-less percept (a mask/pose/depth-only reading) carries
 * its geometry in `mask` / `keypoints` / `depth` / `worldPos` instead. */
export interface VisionDetection {
  /** The 2D box in the frame's own pixel resolution. Absent for a box-less
   * percept. */
  bbox?: DetectionBox;
  classLabel: string;
  confidence: number;
  /** Stable track id across frames (tracking models only). */
  trackId?: number | null;
  /** How confident the tracker is that this detection is the same object as
   * its `trackId` (0..1). Absent when the source does not score association.
   * Distinct from `confidence` (the class/object detection itself). */
  assocConfidence?: number | null;
  /** Discrete identity-lock state this frame. Absent when the source does not
   * report a lock state. */
  lockState?: LockState | null;
  /** Open, self-describing per-detection attributes: model-specific metadata
   * keyed by name, beyond the typed fields below. Absent when the source
   * reports none. A consumer reads only the keys it understands. */
  attributes?: Record<string, unknown> | null;
  /** Segmentation mask as a polygon of `[x, y]` vertices tracing the object
   * outline, in frame pixels. Absent when the source reports no mask. */
  mask?: Array<[number, number]>;
  /** Keypoints (pose joints or landmarks) for this detection, in frame pixels.
   * Absent when the source reports none. */
  keypoints?: DetectionKeypoint[];
  /** Estimated distance from the camera to the detection, in metres. Absent
   * when the source reports no depth. */
  depth?: number;
  /** The detection's position in a world frame, as a bare 3-tuple so the frame
   * convention can evolve: local ENU metres `[x, y, z]` or geographic
   * `[lat, lon, alt]`. Absent when the source reports no world position. */
  worldPos?: [number, number, number];
}

/** A batch of detections for one frame. Carries the source frame
 * dimensions so overlays can scale boxes to the rendered video. Mirrors
 * the vision-contract `DetectionBatch` plus the frame size the boxes are
 * expressed in. */
export interface VisionDetectionBatch {
  modelId: string;
  cameraId: string;
  frameId: number;
  tsMs: number;
  /** Resolution the detection coordinates are expressed in. The overlay
   * scales by (renderedWidth / frameWidth). */
  frameWidth: number;
  frameHeight: number;
  detections: VisionDetection[];
  /** Epoch ms the GCS received the batch. Used to age out stale boxes
   * so an overlay does not pin the last detection forever after the
   * feed stops. */
  receivedAt: number;
}

/** Key one detection STREAM by its model + camera. The engine broadcasts one
 * batch per (model, camera), so a drone running several models — or one model
 * across several cameras — has several concurrent streams. */
export function streamKey(modelId: string, cameraId: string): string {
  return `${modelId}::${cameraId}`;
}

interface VisionDetectionsState {
  /** Latest batch per drone (keyed by drone/device id), across every stream —
   * the simple "what did this drone see most recently" view the cockpit
   * overlay + chip read. For a single-detector drone this is the one stream. */
  batches: Record<string, VisionDetectionBatch>;
  /** Latest batch per drone, split by (model, camera) STREAM, so the vision
   * hub can show every pipeline's output separately instead of the newest one
   * clobbering the rest. Keyed `droneId -> streamKey -> batch`. */
  streams: Record<string, Record<string, VisionDetectionBatch>>;
  /** Per-drone rolling ring buffer of batch receipt timestamps (epoch ms),
   * feeding the live throughput (batches/sec) readout. Ring-buffered so it
   * never grows unbounded (Rule 3). Not part of the reactive render path — read
   * on a tick via {@link receiptTimes}. */
  rateWindows: Record<string, RingBuffer<number>>;
  /** Replace the latest batch for a drone (and its stream). `receivedAt` is
   * stamped here so callers do not have to. */
  setBatch: (
    droneId: string,
    batch: Omit<VisionDetectionBatch, "receivedAt">,
  ) => void;
  /** Receipt timestamps (epoch ms, oldest first) of a drone's recent batches,
   * for computing live throughput over a rolling window. Empty when no feed. */
  receiptTimes: (droneId: string) => number[];
  /** Every current stream for a drone (one per model×camera), newest first. */
  streamsForDrone: (droneId: string) => VisionDetectionBatch[];
  /** Drop a drone's batches (on disconnect or feed stop). */
  clearBatch: (droneId: string) => void;
  /** Reset everything. */
  clear: () => void;
}

export const useVisionDetectionsStore = create<VisionDetectionsState>(
  (set, get) => ({
    batches: {},
    streams: {},
    rateWindows: {},
    setBatch: (droneId, batch) =>
      set((state) => {
        const stamped: VisionDetectionBatch = { ...batch, receivedAt: Date.now() };
        const key = streamKey(stamped.modelId, stamped.cameraId);
        // Rolling receipt window for live throughput. Push in place on the
        // existing ring buffer; only take a new map ref when this drone's
        // window is created, so steady-state pushes cost nothing.
        let rateWindows = state.rateWindows;
        let win = rateWindows[droneId];
        if (!win) {
          win = new RingBuffer<number>(RATE_WINDOW_CAP);
          rateWindows = { ...rateWindows, [droneId]: win };
        }
        win.push(stamped.receivedAt);
        return {
          // Latest-across-streams (the cockpit's simple view).
          batches: { ...state.batches, [droneId]: stamped },
          // Per-stream (the hub's per-pipeline view) — this batch replaces only
          // its own stream, so a second model no longer overwrites the first.
          // Bounded per drone: the (model, camera) key space is agent-supplied
          // and therefore open-ended.
          streams: {
            ...state.streams,
            [droneId]: withStream(state.streams[droneId] ?? {}, key, stamped),
          },
          rateWindows,
        };
      }),
    receiptTimes: (droneId) => get().rateWindows[droneId]?.toArray() ?? [],
    streamsForDrone: (droneId) => {
      const byKey = get().streams[droneId];
      if (!byKey) return [];
      return Object.values(byKey).sort((a, b) => b.receivedAt - a.receivedAt);
    },
    clearBatch: (droneId) =>
      set((state) => {
        if (
          !(droneId in state.batches) &&
          !(droneId in state.streams) &&
          !(droneId in state.rateWindows)
        ) {
          return state;
        }
        const batches = { ...state.batches };
        delete batches[droneId];
        const streams = { ...state.streams };
        delete streams[droneId];
        const rateWindows = { ...state.rateWindows };
        delete rateWindows[droneId];
        return { batches, streams, rateWindows };
      }),
    clear: () => set({ batches: {}, streams: {}, rateWindows: {} }),
  }),
);
