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
import { holdOutsideCrop, type WholeFrame } from "@/lib/vision/crop-hold";

/** Capacity of a drone's rolling receipt-timestamp window. Sized for a few
 * seconds of headroom even at a fast (~30 Hz) inference cadence, so the
 * throughput (batches/sec) readout never grows unbounded (bounded memory). */
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

/** Recent (receipt − tsMs) samples kept per stream. `tsMs` is the agent's
 * host-monotonic frame time (ms since its boot), never wall time, so the
 * smallest sample is the offset between the two clocks plus the stream's
 * best-case latency; a bounded window lets the offset follow drift instead of
 * pinning a stream stale. */
const OFFSET_WINDOW_CAP = 32;

/** Whether `next` was taken before `current` on the same stream. */
function isOlderFrame(
  next: Pick<VisionDetectionBatch, "tsMs" | "frameId">,
  current: VisionDetectionBatch,
): boolean {
  return next.tsMs < current.tsMs || (next.tsMs === current.tsMs && next.frameId < current.frameId);
}

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
 * so all three read the exact same freshness window (one honest
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
  /** Kept from the stream's last whole-frame batch: outside a crop-only
   * batch's window, not re-detected this frame ({@link holdOutsideCrop}). */
  held?: boolean;
}

/** A batch of detections for one frame. Carries the source frame
 * dimensions so overlays can scale boxes to the rendered video. Mirrors
 * the vision-contract `DetectionBatch` plus the frame size the boxes are
 * expressed in. */
export interface VisionDetectionBatch {
  modelId: string;
  cameraId: string;
  frameId: number;
  /** The agent's host-monotonic frame time (ms since its boot). Orders frames
   * within a stream; never compared with wall time. */
  tsMs: number;
  /** Resolution the detection coordinates are expressed in. The overlay
   * scales by (renderedWidth / frameWidth). */
  frameWidth: number;
  frameHeight: number;
  detections: VisionDetection[];
  /** GCS-clock time of the frame, used to age boxes out. It is the frame's
   * capture time `tsMs` shifted onto the GCS clock by the stream's smallest
   * recent (receipt − tsMs) offset, so a frame that arrives with the usual
   * latency reads as just received, while a frame delivered late (a relay or
   * socket backlog, a reconnect) is aged by when it was taken and is not
   * drawn as live. Never later than its actual receipt. */
  receivedAt: number;
  /** The frame-pixel window a crop-only batch was detected in. Absent on a
   * whole-frame batch, which is drawn as it is. */
  cropWindow?: DetectionBox;
  /** The stream's latest whole-frame boxes, held on crop-only batches. Set
   * by the store. */
  wholeFrame?: WholeFrame;
}

/** Key one detection STREAM by its model + camera. The engine broadcasts one
 * batch per (model, camera), so a drone running several models — or one model
 * across several cameras — has several concurrent streams. */
export function streamKey(modelId: string, cameraId: string): string {
  return `${modelId}::${cameraId}`;
}

/** What a stream's clock-restart check needs: the first `tsMs` seen since its
 * clock offset was last learned (the start of its observed span) and the
 * connection epoch it was learned on. */
interface StreamClock {
  firstTsMs: number;
  epoch: number;
}

type FeedMaps = Pick<
  VisionDetectionsState,
  "batches" | "streams" | "rateWindows" | "offsetWindows" | "streamClocks"
>;

/** A drone's feed maps with its entry removed. */
function withoutDrone(state: FeedMaps, droneId: string): FeedMaps {
  const out: FeedMaps = {
    batches: { ...state.batches },
    streams: { ...state.streams },
    rateWindows: { ...state.rateWindows },
    offsetWindows: { ...state.offsetWindows },
    streamClocks: { ...state.streamClocks },
  };
  for (const map of Object.values(out)) delete map[droneId];
  return out;
}

/** `map` limited to the keys `keep` has; the same reference when nothing
 * is dropped, so an unchanged map costs no render. */
function keepKeys<T>(
  map: Record<string, T> | undefined,
  keep: Record<string, unknown>,
): Record<string, T> | undefined {
  if (!map || Object.keys(map).every((k) => k in keep)) return map;
  return Object.fromEntries(Object.entries(map).filter(([k]) => k in keep));
}

/** Whether a drone has any feed state left. Reads the feed maps by name: the
 * store state passed in also carries non-feed records keyed by drone. */
function hasFeed(state: FeedMaps, droneId: string): boolean {
  return (
    droneId in state.batches ||
    droneId in state.streams ||
    droneId in state.rateWindows ||
    droneId in state.offsetWindows ||
    droneId in state.streamClocks
  );
}

/** Whether `batch` comes from a restarted agent: its host-monotonic `tsMs`
 * went backwards and the jump cannot be a late frame of the same run, because
 * it arrived on a new connection, after the stream went stale, or from before
 * the start of the stream's observed span. */
function isClockRestart(
  batch: Pick<VisionDetectionBatch, "tsMs">,
  current: VisionDetectionBatch,
  clock: StreamClock,
  epoch: number,
  now: number,
): boolean {
  if (batch.tsMs >= current.tsMs) return false;
  return (
    clock.epoch !== epoch ||
    now - current.receivedAt > DETECTION_STALE_MS ||
    batch.tsMs < clock.firstTsMs
  );
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
   * never grows unbounded (bounded memory). Not part of the reactive render path — read
   * on a tick via {@link receiptTimes}. */
  rateWindows: Record<string, RingBuffer<number>>;
  /** Per-stream (receipt − tsMs) window, keyed `droneId -> streamKey`. Not
   * part of the reactive render path. */
  offsetWindows: Record<string, Record<string, RingBuffer<number>>>;
  /** Per-stream span start + connection epoch, keyed `droneId -> streamKey`,
   * for telling an agent restart from a late frame. Not reactive. */
  streamClocks: Record<string, Record<string, StreamClock>>;
  /** Per-drone connection epoch, bumped by {@link markReconnect}. */
  connectionEpochs: Record<string, number>;
  /** Drones whose agent reported its vision engine unreachable
   * (`available:false` on the detection poll or the detection socket's close
   * reason), so a surface can say "vision not running" instead of reading an
   * empty feed as "nothing detected". Absent = not reported. The next batch
   * clears it. */
  visionUnavailable: Record<string, true>;
  /** Drones whose agent sent a detection batch at a wire version this GCS
   * does not speak (the batch is dropped), keyed to that version, so a
   * surface can tell the operator to update. A batch clears it. */
  outdatedDetectionVersion: Record<string, number>;
  /** Record that `droneId` sent an unsupported detection wire version. */
  setOutdatedDetectionVersion: (droneId: string, version: number) => void;
  /** Replace the latest batch for a drone (and its stream). `receivedAt` is
   * stamped here so callers do not have to. A batch taken before the one its
   * stream already shows is dropped while that one is still fresh.
   * `fullFrame` is a whole-frame batch that came with a crop-only one (a
   * polled reply's `full_frame`); its boxes are held like the stream's own
   * ({@link holdOutsideCrop}). */
  setBatch: (
    droneId: string,
    batch: Omit<VisionDetectionBatch, "receivedAt" | "wholeFrame">,
    fullFrame?: WholeFrame,
  ) => void;
  /** Record the agent's engine-availability report for a drone. `false`
   * drops the drone's batches (there is no live feed) and flags it; `true`
   * clears the flag. */
  setVisionAvailable: (droneId: string, available: boolean) => void;
  /** Record that a drone's detection connection dropped: the next batch on
   * it comes over a new connection, so a backward frame time is a restart. */
  markReconnect: (droneId: string) => void;
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
    offsetWindows: {},
    streamClocks: {},
    connectionEpochs: {},
    visionUnavailable: {},
    outdatedDetectionVersion: {},
    setBatch: (droneId, batch, fullFrame) =>
      set((state) => {
        const now = Date.now();
        const key = streamKey(batch.modelId, batch.cameraId);
        const current = state.streams[droneId]?.[key];
        const epoch = state.connectionEpochs[droneId] ?? 0;
        const clock = state.streamClocks[droneId]?.[key];
        const restarted =
          current !== undefined &&
          clock !== undefined &&
          isClockRestart(batch, current, clock, epoch, now);
        // Out-of-order delivery: never let an older frame replace a newer one
        // that is still on screen. A restarted agent's frames are new, not old.
        if (
          current &&
          !restarted &&
          now - current.receivedAt <= DETECTION_STALE_MS &&
          isOlderFrame(batch, current)
        ) {
          return state;
        }

        let offsetWindows = state.offsetWindows;
        let droneOffsets = offsetWindows[droneId];
        let offsets = droneOffsets?.[key];
        let streamClocks = state.streamClocks;
        if (!offsets || !clock || restarted) {
          offsets = new RingBuffer<number>(OFFSET_WINDOW_CAP);
          droneOffsets = { ...droneOffsets, [key]: offsets };
          offsetWindows = { ...offsetWindows, [droneId]: droneOffsets };
          streamClocks = {
            ...streamClocks,
            [droneId]: { ...streamClocks[droneId], [key]: { firstTsMs: batch.tsMs, epoch } },
          };
        } else {
          // Learned on an earlier connection and still the same run: carry
          // the span over to this connection.
          clock.epoch = epoch;
        }
        offsets.push(now - batch.tsMs);
        const offset = Math.min(...offsets.toArray());
        const hold = holdOutsideCrop(current, batch, fullFrame);
        const stamped: VisionDetectionBatch = {
          ...batch,
          ...hold,
          receivedAt: batch.tsMs + offset,
        };
        // Rolling receipt window for live throughput. Push in place on the
        // existing ring buffer; only take a new map ref when this drone's
        // window is created, so steady-state pushes cost nothing.
        let rateWindows = state.rateWindows;
        let win = rateWindows[droneId];
        if (!win) {
          win = new RingBuffer<number>(RATE_WINDOW_CAP);
          rateWindows = { ...rateWindows, [droneId]: win };
        }
        win.push(now);
        // A batch is proof the engine is running again.
        let visionUnavailable = state.visionUnavailable;
        if (droneId in visionUnavailable) {
          visionUnavailable = { ...visionUnavailable };
          delete visionUnavailable[droneId];
        }
        let outdatedDetectionVersion = state.outdatedDetectionVersion;
        if (droneId in outdatedDetectionVersion) {
          outdatedDetectionVersion = { ...outdatedDetectionVersion };
          delete outdatedDetectionVersion[droneId];
        }
        // Bounded per drone: the (model, camera) key space is agent-supplied
        // and therefore open-ended, so the per-stream clock maps follow the
        // streams `withStream` keeps.
        const droneStreams = withStream(state.streams[droneId] ?? {}, key, stamped);
        const keptOffsets = keepKeys(offsetWindows[droneId], droneStreams);
        if (keptOffsets && keptOffsets !== offsetWindows[droneId]) {
          offsetWindows = { ...offsetWindows, [droneId]: keptOffsets };
        }
        const keptClocks = keepKeys(streamClocks[droneId], droneStreams);
        if (keptClocks && keptClocks !== streamClocks[droneId]) {
          streamClocks = { ...streamClocks, [droneId]: keptClocks };
        }
        return {
          // Latest-across-streams (the cockpit's simple view).
          batches: { ...state.batches, [droneId]: stamped },
          // Per-stream (the hub's per-pipeline view) — this batch replaces only
          // its own stream, so a second model no longer overwrites the first.
          streams: { ...state.streams, [droneId]: droneStreams },
          rateWindows,
          offsetWindows,
          streamClocks,
          visionUnavailable,
          outdatedDetectionVersion,
        };
      }),
    setVisionAvailable: (droneId, available) =>
      set((state) => {
        if (available) {
          if (!(droneId in state.visionUnavailable)) return state;
          const visionUnavailable = { ...state.visionUnavailable };
          delete visionUnavailable[droneId];
          return { visionUnavailable };
        }
        // The relay lane repeats the report every poll: an already-flagged
        // drone with no feed left is a no-op, not a fresh render.
        const flagged = droneId in state.visionUnavailable;
        if (flagged && !hasFeed(state, droneId)) {
          return state;
        }
        const visionUnavailable = flagged
          ? state.visionUnavailable
          : { ...state.visionUnavailable, [droneId]: true as const };
        return { ...withoutDrone(state, droneId), visionUnavailable };
      }),
    setOutdatedDetectionVersion: (droneId, version) =>
      set((state) =>
        state.outdatedDetectionVersion[droneId] === version
          ? state
          : { outdatedDetectionVersion: { ...state.outdatedDetectionVersion, [droneId]: version } },
      ),
    markReconnect: (droneId) =>
      set((state) => ({
        connectionEpochs: {
          ...state.connectionEpochs,
          [droneId]: (state.connectionEpochs[droneId] ?? 0) + 1,
        },
      })),
    receiptTimes: (droneId) => get().rateWindows[droneId]?.toArray() ?? [],
    streamsForDrone: (droneId) => {
      const byKey = get().streams[droneId];
      if (!byKey) return [];
      return Object.values(byKey).sort((a, b) => b.receivedAt - a.receivedAt);
    },
    clearBatch: (droneId) =>
      set((state) => {
        if (
          !hasFeed(state, droneId) &&
          !(droneId in state.visionUnavailable) &&
          !(droneId in state.outdatedDetectionVersion)
        ) {
          return state;
        }
        const visionUnavailable = { ...state.visionUnavailable };
        delete visionUnavailable[droneId];
        const outdatedDetectionVersion = { ...state.outdatedDetectionVersion };
        delete outdatedDetectionVersion[droneId];
        return { ...withoutDrone(state, droneId), visionUnavailable, outdatedDetectionVersion };
      }),
    clear: () =>
      set({
        batches: {},
        streams: {},
        rateWindows: {},
        offsetWindows: {},
        streamClocks: {},
        connectionEpochs: {},
        visionUnavailable: {},
        outdatedDetectionVersion: {},
      }),
  }),
);
