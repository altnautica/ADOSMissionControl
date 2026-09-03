/**
 * @module video/latency-budget
 * @description Per-hop receive latency, measured from
 * `requestVideoFrameCallback` frame metadata, with the provenance of every
 * term recorded beside it.
 *
 * ## What this replaces
 *
 * The video surfaces used to report one roll-up number built from
 * `RTCPeerConnection` stats — network RTT plus the decoder's average jitter
 * buffer wait — and a receiver-side jitter target pinned to a constant that
 * no measurement produced. Neither told an operator where the delay was, and
 * the roll-up was not even the same quantity as end-to-end latency: RTT is a
 * round trip, and no part of the capture or encode leg appears in it at all.
 *
 * `requestVideoFrameCallback` hands the receiver four timestamps per rendered
 * frame, which is enough to split the receive path properly. On this path the
 * honest end-to-end figure is ~180 ms P50 / ~240 ms P95 on a LAN with a
 * hardware-encoded publisher; the media server is 30-80 ms of that and the
 * remainder is encoder plus receiver buffer. A browser cannot see the media
 * server's share — it is between two hops this module measures — so it is
 * reported as {@link UNAVAILABLE_HOPS} rather than modelled.
 *
 * ## Provenance, per term
 *
 * - `measured` — a difference between two timestamps the user agent reports
 *   directly, both on the same clock as `performance.now()`.
 * - `rtcp-synchronised` — one endpoint is `captureTime`, which for a remote
 *   source the user agent estimates from RTCP sender reports plus clock
 *   synchronisation. Real, but only as good as that synchronisation, and it
 *   is absent entirely on a non-WebRTC source.
 * - `derived` — a subtraction of two other terms rather than an observation.
 * - `ua-estimated` — one endpoint is `expectedDisplayTime`, which is the user
 *   agent's *prediction* of when the frame becomes visible, not a report that
 *   it did.
 *
 * A term is never presented without its provenance. A latency number an
 * operator cannot trace is worse than no number.
 *
 * @license GPL-3.0-only
 */

export type LatencyProvenance =
  | "measured"
  | "rtcp-synchronised"
  | "derived"
  | "ua-estimated";

/** The hops of the receive path this module reports. */
export type LatencyHopId =
  | "captureToReceive"
  | "receiveToPresent"
  | "decode"
  | "bufferAndComposite"
  | "presentToDisplay"
  | "endToEnd";

/**
 * Hops no browser API exposes, named so a surface can say "not measured"
 * instead of leaving a gap that reads as zero.
 *
 * The media server's own contribution sits inside `captureToReceive` and
 * cannot be separated from the encode and network legs by a receiver. The
 * capture-to-encoder-input leg is upstream of every timestamp the browser
 * sees; the agent's SEI probe is the only surface that can measure it.
 */
export const UNAVAILABLE_HOPS = [
  "media-server queueing",
  "camera to encoder input",
] as const;

export const LATENCY_HOP_PROVENANCE: Record<LatencyHopId, LatencyProvenance> = {
  // captureTime is RTCP-synchronised; receiveTime is directly reported.
  captureToReceive: "rtcp-synchronised",
  receiveToPresent: "measured",
  decode: "measured",
  // receiveToPresent minus decode. A subtraction, not an observation.
  bufferAndComposite: "derived",
  presentToDisplay: "ua-estimated",
  // Anchored on captureTime, so it inherits the RTCP-synchronised caveat.
  endToEnd: "rtcp-synchronised",
};

/**
 * The subset of `VideoFrameCallbackMetadata` this module reads. Declared
 * locally because `lib.dom` does not yet carry the WebRTC-source fields, and
 * because narrowing to what is used keeps the optionality honest: on a
 * non-WebRTC source `captureTime` and `receiveTime` are simply absent.
 */
export interface FrameLatencyMetadata {
  presentationTime: number;
  expectedDisplayTime: number;
  captureTime?: number;
  receiveTime?: number;
  processingDuration?: number;
  rtpTimestamp?: number;
}

/** One frame's worth of derived hop durations, in ms. */
export interface LatencySample {
  captureToReceiveMs: number;
  receiveToPresentMs: number;
  decodeMs: number;
  bufferAndCompositeMs: number;
  presentToDisplayMs: number;
  endToEndMs: number;
}

/**
 * Upper bound on a plausible end-to-end figure. Above this the RTCP clock
 * synchronisation has not converged (it is unusable for the first second or
 * so of a session) and the sample would drag the percentiles somewhere no
 * operator should read.
 */
const MAX_PLAUSIBLE_END_TO_END_MS = 5_000;

/**
 * Derive one sample, or `null` when the metadata cannot support one.
 *
 * Pure, so the arithmetic is testable without a browser or a peer
 * connection — which matters because getting a subtraction backwards here
 * produces a plausible-looking number rather than an error.
 */
export function deriveLatencySample(
  metadata: FrameLatencyMetadata,
): LatencySample | null {
  const { captureTime, receiveTime, presentationTime, expectedDisplayTime } =
    metadata;
  if (
    !Number.isFinite(captureTime) ||
    !Number.isFinite(receiveTime) ||
    !Number.isFinite(presentationTime)
  ) {
    return null;
  }
  const capture = captureTime as number;
  const receive = receiveTime as number;

  const captureToReceiveMs = receive - capture;
  const receiveToPresentMs = presentationTime - receive;
  const endToEndMs = presentationTime - capture;
  if (
    captureToReceiveMs < 0 ||
    receiveToPresentMs < 0 ||
    endToEndMs <= 0 ||
    endToEndMs > MAX_PLAUSIBLE_END_TO_END_MS
  ) {
    return null;
  }

  // processingDuration is the summed decode time for the frame. Absent on
  // some sources; a missing value must not silently become "decode took 0",
  // so the derived remainder collapses to the whole receive leg instead.
  const decodeMs =
    Number.isFinite(metadata.processingDuration) &&
    (metadata.processingDuration as number) >= 0
      ? Math.min(metadata.processingDuration as number, receiveToPresentMs)
      : 0;

  const presentToDisplayMs = Number.isFinite(expectedDisplayTime)
    ? Math.max(expectedDisplayTime - presentationTime, 0)
    : 0;

  return {
    captureToReceiveMs,
    receiveToPresentMs,
    decodeMs,
    bufferAndCompositeMs: receiveToPresentMs - decodeMs,
    presentToDisplayMs,
    endToEndMs,
  };
}

/** A reported hop: percentiles plus how the number was obtained. */
export interface LatencyHop {
  p50Ms: number;
  p95Ms: number;
  provenance: LatencyProvenance;
}

export interface LatencyBudget {
  /** Frames the percentiles are computed over. Zero means "no data yet". */
  samples: number;
  /** Present only once a WebRTC source has supplied `captureTime`. */
  hops: Record<LatencyHopId, LatencyHop> | null;
  /** Hops nothing in the browser can measure. */
  unavailable: readonly string[];
  /** Bumped on every published change so a subscriber can bail cheaply. */
  version: number;
}

/**
 * Ten seconds at 30 fps. Long enough for a stable P95, short enough that the
 * window still describes the link as it is now rather than as it was.
 */
const CAPACITY = 300;

/** Struct-of-arrays: one preallocated lane per hop, no per-frame objects. */
const lanes: Record<keyof LatencySample, Float64Array> = {
  captureToReceiveMs: new Float64Array(CAPACITY),
  receiveToPresentMs: new Float64Array(CAPACITY),
  decodeMs: new Float64Array(CAPACITY),
  bufferAndCompositeMs: new Float64Array(CAPACITY),
  presentToDisplayMs: new Float64Array(CAPACITY),
  endToEndMs: new Float64Array(CAPACITY),
};
const laneKeys = Object.keys(lanes) as (keyof LatencySample)[];

let writeIndex = 0;
let filled = 0;
let version = 0;

/** Scratch for percentile sorting, so a read allocates nothing. */
const scratch = new Float64Array(CAPACITY);

const listeners = new Set<() => void>();

/**
 * Notification floor. Frames arrive at up to the display rate; a React
 * subscriber that re-rendered per frame would cost more than the measurement
 * is worth. Percentiles over a ten-second window do not move meaningfully
 * faster than this anyway.
 */
const NOTIFY_INTERVAL_MS = 250;
let lastNotifyAt = 0;

const EMPTY_BUDGET: LatencyBudget = {
  samples: 0,
  hops: null,
  unavailable: UNAVAILABLE_HOPS,
  version: 0,
};

/**
 * The published snapshot. Cached and only replaced when something changed:
 * `getLatencyBudget` is a `getSnapshot` for React, and returning a fresh
 * object per call is the documented cause of an infinite re-render loop.
 */
let snapshot: LatencyBudget = EMPTY_BUDGET;
let snapshotVersion = -1;

/** Nearest-rank percentile over the `count` live entries of `lane`. */
function percentile(lane: Float64Array, count: number, fraction: number): number {
  const view = scratch.subarray(0, count);
  view.set(lane.subarray(0, count));
  view.sort();
  const rank = Math.min(count - 1, Math.max(0, Math.ceil(fraction * count) - 1));
  return Math.round(view[rank] * 10) / 10;
}

function hopFor(key: keyof LatencySample, id: LatencyHopId, count: number): LatencyHop {
  return {
    p50Ms: percentile(lanes[key], count, 0.5),
    p95Ms: percentile(lanes[key], count, 0.95),
    provenance: LATENCY_HOP_PROVENANCE[id],
  };
}

/**
 * Record one derived sample. Call from the frame callback; the arithmetic is
 * a handful of writes into preallocated lanes plus a rate-limited notify.
 */
export function recordLatencySample(sample: LatencySample): void {
  for (const key of laneKeys) {
    lanes[key][writeIndex] = sample[key];
  }
  writeIndex = (writeIndex + 1) % CAPACITY;
  if (filled < CAPACITY) filled += 1;
  version += 1;

  const now = Date.now();
  if (now - lastNotifyAt < NOTIFY_INTERVAL_MS) return;
  lastNotifyAt = now;
  for (const listener of listeners) listener();
}

/**
 * Derive and record in one call. Returns the sample so a caller can reuse
 * the end-to-end figure without re-deriving it, and `null` when the frame
 * carried no usable timestamps.
 */
export function observeFrameLatency(
  metadata: FrameLatencyMetadata,
): LatencySample | null {
  const sample = deriveLatencySample(metadata);
  if (sample) recordLatencySample(sample);
  return sample;
}

/** Cached snapshot of the current budget. Stable between changes. */
export function getLatencyBudget(): LatencyBudget {
  if (snapshotVersion === version) return snapshot;
  snapshotVersion = version;
  if (filled === 0) {
    snapshot = EMPTY_BUDGET;
    return snapshot;
  }
  snapshot = {
    samples: filled,
    hops: {
      captureToReceive: hopFor("captureToReceiveMs", "captureToReceive", filled),
      receiveToPresent: hopFor("receiveToPresentMs", "receiveToPresent", filled),
      decode: hopFor("decodeMs", "decode", filled),
      bufferAndComposite: hopFor(
        "bufferAndCompositeMs",
        "bufferAndComposite",
        filled,
      ),
      presentToDisplay: hopFor("presentToDisplayMs", "presentToDisplay", filled),
      endToEnd: hopFor("endToEndMs", "endToEnd", filled),
    },
    unavailable: UNAVAILABLE_HOPS,
    version,
  };
  return snapshot;
}

export function subscribeLatencyBudget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Drop every sample. Called on stream teardown: percentiles carried across a
 * reconnect would describe a link that no longer exists.
 */
export function resetLatencyBudget(): void {
  writeIndex = 0;
  filled = 0;
  version += 1;
  lastNotifyAt = 0;
  for (const listener of listeners) listener();
}
