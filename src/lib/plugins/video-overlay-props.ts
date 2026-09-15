/**
 * Host-prop contract for the `video.overlay` slot.
 *
 * The cockpit pushes one `VideoOverlayHostProps` payload to each mounted
 * overlay iframe as a non-gated bridge event (`video.overlay.props`). The
 * payload carries everything an overlay needs to draw in the video's own
 * coordinate space and to map a click back to a frame pixel: the rendered
 * (letterbox-corrected) video rect, the stream resolution, the latest
 * attitude, and the latest detection batch.
 *
 * Cadence: pushed when a new detection batch lands, and on the shared 1 Hz
 * clock so a freshness transition is observable with no new data arriving.
 * Geometry is re-pushed only on resize / resolution change. When no batch has
 * arrived within the staleness window the host pushes `detections: null` so
 * overlays drop their boxes, and `attitude: null` once the attitude samples
 * behind it have gone stale.
 *
 * Frame alignment: the attitude is the sample that was true at
 * `now - frameAgeMs`, not the newest one, so it belongs to the same instant
 * as the frame the overlay is drawn over. `frameAgeMs` and
 * `attitudeAtFrameTime` state which of those the payload actually carries, so
 * an overlay never has to guess whether the two halves share a clock.
 *
 * @module plugins/video-overlay-props
 * @license GPL-3.0-only
 */

/** The non-gated bridge event method overlay host-props ride. */
export const VIDEO_OVERLAY_PROPS_EVENT = "video.overlay.props";

/** Capability tag carried on the event (events are not gated; this is the
 * slot's capability so an overlay can sanity-check the source). */
export const VIDEO_OVERLAY_PROPS_CAPABILITY = "ui.slot.video-overlay";

/** The letterbox-corrected rendered video rect, in CSS px relative to the
 * overlay wrapper's top-left. */
export interface RenderedRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One detection mapped into the host-props shape (a plain serializable
 * subset of the store's VisionDetection). */
export interface VideoOverlayDetectionItem {
  bbox: { x: number; y: number; width: number; height: number };
  classLabel: string;
  confidence: number;
  trackId: number | null;
  lockState: "locked" | "uncertain" | "lost" | null;
}

/** The detection batch carried on the host props, or null when stale/absent. */
export interface VideoOverlayDetections {
  frameWidth: number;
  frameHeight: number;
  frameId: number;
  receivedAt: number;
  items: VideoOverlayDetectionItem[];
}

/** Host props pushed to a `video.overlay` iframe. */
export interface VideoOverlayHostProps {
  droneId: string;
  cameraId: string;
  /** Stream resolution (intrinsic video dimensions). */
  streamWidth: number;
  streamHeight: number;
  /** Letterbox-corrected rendered rect (CSS px, relative to wrapper). */
  renderedRect: RenderedRect;
  /** Timestamp (ms) of the frame the detections/attitude are coalesced to. */
  frameTimestampMs: number;
  /**
   * Measured age of the frame on screen, in ms, or `null` when no estimator
   * knows it.
   *
   * The host's own delay estimate, from `lib/video/frame-age`. An overlay
   * that does its own dead reckoning or lead computation needs this: it is
   * the offset between the picture and the live world.
   */
  frameAgeMs: number | null;
  /**
   * Latest attitude in degrees, or `null` when it is unknown or stale.
   *
   * Nullable on purpose, for the same reason `HorizonSvg` made its own
   * inputs nullable: this used to be `roll ?? 0`, so an overlay drawing a
   * horizon off a dead link painted a perfectly wings-level aircraft — the
   * one reading a pilot must never be shown when the attitude is unknown,
   * and the one that is indistinguishable from a correct reading. An
   * overlay must raise its own failure flag on `null`, never substitute a
   * zero.
   */
  attitude: { rollDeg: number; pitchDeg: number; yawDeg: number } | null;
  /**
   * Whether `attitude` is the sample that was true when the frame was
   * captured, rather than the newest sample available.
   *
   * `true` when the host knew the frame age and reached back by it; `false`
   * when it did not and handed over the newest sample instead. The payload
   * used to pair a timestamped frame with an untimestamped current attitude
   * and ship both as one instant, so an overlay could not even correct for
   * the skew. Now it can: `false` plus a `null` `frameAgeMs` says "these two
   * are from different moments and I cannot tell you how far apart".
   */
  attitudeAtFrameTime: boolean;
  detections: VideoOverlayDetections | null;
}
