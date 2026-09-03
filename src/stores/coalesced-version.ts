/**
 * @module coalesced-version
 * @description The shared rAF version bumper for any store fed by live
 * telemetry.
 *
 * The rule this enforces: a store written at message rate must not notify
 * subscribers at message rate. A MAVLink stream delivers 100-400 decoded
 * frames/sec and a DroneCAN bus several thousand, so one Zustand `set()` per
 * message is one React commit per message. Coalescing collapses a whole frame's
 * worth of pushes into a single monotonic `_version` bump, which caps
 * notification at the display rate no matter how fast the wire runs.
 *
 * Mutate the payload (a `RingBuffer`, a `Map`) in place, then call
 * `scheduleVersionBump()`. Consumers select `_version` and re-read.
 *
 * `clear()` MUST call `cancelVersionBump()`: the pending rAF/timeout handle is
 * module state with no component teardown, so without cancellation a bump
 * scheduled before a reset lands afterwards and re-notifies against the fresh
 * store — visible in tests as a `beforeEach`-reset store that ticks once more,
 * and in the SSR `setTimeout` fallback as a bump after unmount.
 *
 * @license GPL-3.0-only
 */

/** Minimum store shape a coalesced bumper can drive. */
export interface VersionedState {
  _version: number;
}

/** SSR / Node fallback interval, one 60 Hz frame. */
const FALLBACK_FRAME_MS = 16;

/**
 * Cancels a scheduled bump. Storing the canceller rather than the raw handle
 * keeps the DOM `requestAnimationFrame` number and the Node `setTimeout`
 * object out of this module's types.
 */
type Canceller = () => void;

/** A coalesced `_version` bumper bound to one store. */
export interface VersionBumper {
  /**
   * Request a `_version` bump on the next animation frame. Idempotent within a
   * frame: N calls produce exactly one bump.
   */
  scheduleVersionBump: () => void;
  /**
   * Drop a pending bump without applying it. Call from `clear()` so a reset is
   * not followed by a stale notification.
   */
  cancelVersionBump: () => void;
  /** True while a bump is scheduled. Test affordance. */
  hasPendingBump: () => boolean;
}

/**
 * Create a coalesced bumper that invokes `bump` at most once per animation
 * frame.
 *
 * `bump` is supplied rather than a store handle so the bumper can be created
 * inside a `create()` initializer, before the store binding exists, and so the
 * coalescing logic is testable without a store at all.
 */
export function createVersionBumper(bump: () => void): VersionBumper {
  let cancel: Canceller | null = null;

  const apply = () => {
    cancel = null;
    bump();
  };

  return {
    scheduleVersionBump: () => {
      if (cancel !== null) return;
      if (typeof requestAnimationFrame !== "undefined") {
        const handle = requestAnimationFrame(apply);
        cancel = () => cancelAnimationFrame(handle);
      } else {
        const handle = setTimeout(apply, FALLBACK_FRAME_MS);
        cancel = () => clearTimeout(handle);
      }
    },
    cancelVersionBump: () => {
      if (cancel === null) return;
      const run = cancel;
      cancel = null;
      run();
    },
    hasPendingBump: () => cancel !== null,
  };
}
