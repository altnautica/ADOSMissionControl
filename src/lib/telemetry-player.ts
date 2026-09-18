/**
 * Telemetry playback system.
 *
 * Loads recorded telemetry frames from IndexedDB and replays them
 * through the telemetry store at configurable speeds. Pairs with
 * telemetry-recorder.ts for record/replay workflows.
 *
 * @module telemetry-player
 * @license GPL-3.0-only
 */

import { loadRecordingFrames, listRecordings } from "@/lib/telemetry-recorder";
import type { TelemetryFrame, TelemetryRecording } from "@/lib/telemetry-recorder";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";

// ── Types ────────────────────────────────────────────────────

export type PlaybackState = "stopped" | "playing" | "paused";
export type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4 | 8;

export interface PlaybackStatus {
  state: PlaybackState;
  currentTimeMs: number;
  totalDurationMs: number;
  playbackSpeed: PlaybackSpeed;
  recordingId: string | null;
  frameIndex: number;
  totalFrames: number;
}

// ── Channel → Store Dispatch Map ─────────────────────────────

/** The telemetry-store push methods replay is allowed to drive. */
type PushMethod =
  | "pushAttitude"
  | "pushPosition"
  | "pushBattery"
  | "pushGps"
  | "pushRadio"
  | "pushRc"
  | "pushVfr"
  | "pushSysStatus"
  | "pushEkf"
  | "pushVibration"
  | "pushServoOutput"
  | "pushWind"
  | "pushTerrain"
  | "pushLocalPosition"
  | "pushDebug"
  | "pushGimbal"
  | "pushObstacle";

/**
 * Maps recording channel names to telemetry store push methods.
 * Channels not in this map are silently skipped during playback.
 *
 * Naming the METHOD rather than wrapping each one in a closure is what
 * removes the sixteen `as any` casts this table used to carry: each
 * closure asserted its own payload type independently, so the replay path
 * had no type contract with the store at all and a recorder-side field
 * rename would have gone unnoticed. The single widening now lives in
 * `dispatchFrame`, where it is stated once and explained.
 */
const CHANNEL_DISPATCH: Record<string, PushMethod> = {
  attitude: "pushAttitude",
  position: "pushPosition",
  battery: "pushBattery",
  gps: "pushGps",
  radio: "pushRadio",
  rc: "pushRc",
  vfr: "pushVfr",
  sysStatus: "pushSysStatus",
  ekf: "pushEkf",
  vibration: "pushVibration",
  servoOutput: "pushServoOutput",
  wind: "pushWind",
  terrain: "pushTerrain",
  localPosition: "pushLocalPosition",
  debug: "pushDebug",
  gimbal: "pushGimbal",
  obstacle: "pushObstacle",
};

// ── Singleton State ──────────────────────────────────────────

let _state: PlaybackState = "stopped";
let _speed: PlaybackSpeed = 1;
let _frames: TelemetryFrame[] = [];
let _frameIndex = 0;
let _recordingId: string | null = null;
let _totalDurationMs = 0;

/** Wall-clock time (performance.now) when playback started/resumed. */
let _playStartWall = 0;
/** Recording offset (ms) when playback started/resumed. */
let _playStartOffset = 0;

let _rafId: number | null = null;

/**
 * Listeners notified on every state change.
 *
 * A SET, not a single slot. `onPlaybackChange` used to overwrite one
 * variable, so the second subscriber silently unsubscribed the first —
 * mount a transport bar beside a scrubber and one of them stops updating,
 * with the loser depending on mount order. The unsubscribe is also now
 * exact: the old one compared identity against the slot, so unmounting
 * the FIRST of two subscribers was a no-op that left it attached.
 */
const _onChange = new Set<(status: PlaybackStatus) => void>();

// ── Internal Helpers ─────────────────────────────────────────

function currentTimeMs(): number {
  if (_state === "playing") {
    const elapsed = (performance.now() - _playStartWall) * _speed;
    return Math.min(_playStartOffset + elapsed, _totalDurationMs);
  }
  return _playStartOffset;
}

function emitChange(): void {
  if (_onChange.size === 0) return;
  const status = getPlaybackState();
  for (const cb of _onChange) cb(status);
}

function dispatchFrame(frame: TelemetryFrame): void {
  if (frame.channel === "heartbeat") {
    useDroneStore.getState().heartbeat();
    return;
  }
  const method = CHANNEL_DISPATCH[frame.channel];
  if (!method) return;
  // The ONE widening on the replay path, and the reason it is an unchecked
  // cast rather than a schema parse: these frames were written by
  // `telemetry-recorder` from the same in-process types on the way in, so
  // the shape is ours, not external, and per-channel validation of a
  // 17-way union at replay frame rate would cost more than it proves. The
  // table above is what keeps the channel→method mapping honest; this line
  // only tells the compiler the payload matches the method it picked.
  const push = useTelemetryStore.getState()[method] as (
    data: unknown,
  ) => void;
  push(frame.data);
}

/**
 * Core playback loop driven by requestAnimationFrame.
 * Dispatches all frames whose offsetMs falls within the current playback time.
 */
function tick(): void {
  if (_state !== "playing") return;

  const now = currentTimeMs();

  // Dispatch all frames up to current time
  while (_frameIndex < _frames.length && _frames[_frameIndex].offsetMs <= now) {
    dispatchFrame(_frames[_frameIndex]);
    _frameIndex++;
  }

  // Check if playback complete
  if (_frameIndex >= _frames.length || now >= _totalDurationMs) {
    stop();
    return;
  }

  _rafId = requestAnimationFrame(tick);
  emitChange();
}

// ── Public API ───────────────────────────────────────────────

/**
 * Load a recording for playback. Does not auto-play.
 * Clears telemetry store to start fresh.
 */
export async function loadPlayback(recordingId: string): Promise<void> {
  // Stop any active playback
  if (_state !== "stopped") stop();

  _frames = await loadRecordingFrames(recordingId);
  if (_frames.length === 0) {
    throw new Error(`No frames found for recording ${recordingId}`);
  }

  // Ensure frames are sorted by offset (should already be, but defensive)
  _frames.sort((a, b) => a.offsetMs - b.offsetMs);

  _recordingId = recordingId;
  _totalDurationMs = _frames[_frames.length - 1].offsetMs;
  _frameIndex = 0;
  _playStartOffset = 0;
  _state = "stopped";

  // Clear telemetry store for clean playback
  useTelemetryStore.getState().clear();

  emitChange();
}

/**
 * Start playback from the beginning.
 *
 * Refuses while a vehicle is connected. Replay writes into the SAME
 * telemetry singleton the live link writes into, so with both running the
 * rings interleave a recorded flight with the aircraft in front of the
 * operator — and every consumer downstream (the HUD, the cockpit band,
 * the analyser) reads the result as current. There is no marker on a
 * pushed sample saying which one it came from, so the only safe rule is
 * that exactly one producer owns the store at a time.
 */
export function play(): void {
  if (_frames.length === 0) {
    throw new Error("No recording loaded — call loadPlayback() first");
  }
  if (useDroneStore.getState().connectionState === "connected") {
    throw new Error(
      "Disconnect the vehicle before replaying: playback and live telemetry share one store, and interleaving them renders a recording as live flight data",
    );
  }
  // Reset to start
  _frameIndex = 0;
  _playStartOffset = 0;
  _playStartWall = performance.now();
  _state = "playing";

  useTelemetryStore.getState().clear();

  if (_rafId !== null) cancelAnimationFrame(_rafId);
  _rafId = requestAnimationFrame(tick);
  emitChange();
}

/**
 * Pause playback at current position.
 */
export function pause(): void {
  if (_state !== "playing") return;

  // Snapshot current offset before stopping the clock
  _playStartOffset = currentTimeMs();
  _state = "paused";

  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }

  emitChange();
}

/**
 * Resume playback from paused position.
 */
export function resume(): void {
  if (_state !== "paused") return;

  _playStartWall = performance.now();
  _state = "playing";

  _rafId = requestAnimationFrame(tick);
  emitChange();
}

/**
 * Stop playback and reset to beginning.
 */
export function stop(): void {
  _state = "stopped";
  _frameIndex = 0;
  _playStartOffset = 0;

  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }

  emitChange();
}

/**
 * Seek to a specific offset in the recording.
 * Works in any state (playing, paused, stopped).
 * Re-dispatches the most recent frame per channel up to the seek point
 * so the UI reflects the correct state at that time.
 */
export function seek(offsetMs: number): void {
  if (_frames.length === 0) return;

  const clampedOffset = Math.max(0, Math.min(offsetMs, _totalDurationMs));
  const wasPlaying = _state === "playing";

  // Pause the RAF loop while we seek
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }

  // Clear telemetry store for clean seek
  useTelemetryStore.getState().clear();

  // Find the frame index at the seek point
  _frameIndex = 0;
  while (_frameIndex < _frames.length && _frames[_frameIndex].offsetMs <= clampedOffset) {
    _frameIndex++;
  }

  // Replay the last frame per channel up to this point so the UI
  // shows correct values at the seek position
  const lastPerChannel = new Map<string, TelemetryFrame>();
  for (let i = 0; i < _frameIndex; i++) {
    lastPerChannel.set(_frames[i].channel, _frames[i]);
  }
  for (const frame of lastPerChannel.values()) {
    dispatchFrame(frame);
  }

  // Update offsets
  _playStartOffset = clampedOffset;
  _playStartWall = performance.now();

  // Resume playing if we were playing before seek
  if (wasPlaying) {
    _state = "playing";
    _rafId = requestAnimationFrame(tick);
  } else if (_state === "stopped") {
    _state = "paused";
  }

  emitChange();
}

/**
 * Set playback speed. Takes effect immediately during playback.
 */
export function setSpeed(speed: PlaybackSpeed): void {
  if (_state === "playing") {
    // Snapshot current position before changing speed
    _playStartOffset = currentTimeMs();
    _playStartWall = performance.now();
  }

  _speed = speed;
  emitChange();
}

/**
 * Get current playback state snapshot.
 */
export function getPlaybackState(): PlaybackStatus {
  return {
    state: _state,
    currentTimeMs: currentTimeMs(),
    totalDurationMs: _totalDurationMs,
    playbackSpeed: _speed,
    recordingId: _recordingId,
    frameIndex: _frameIndex,
    totalFrames: _frames.length,
  };
}

/**
 * Subscribe to playback state changes.
 * Returns an unsubscribe function.
 */
export function onPlaybackChange(
  cb: (status: PlaybackStatus) => void,
): () => void {
  _onChange.add(cb);
  return () => {
    _onChange.delete(cb);
  };
}

/**
 * Check if a recording is loaded and ready for playback.
 */
export function isLoaded(): boolean {
  return _frames.length > 0 && _recordingId !== null;
}
