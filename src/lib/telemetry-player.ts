/**
 * Telemetry playback system.
 *
 * Loads recorded telemetry frames from IndexedDB and replays them
 * through the telemetry store at configurable speeds. Pairs with
 * telemetry-recorder.ts for record/replay workflows.
 *
 * Replay writes into the SAME telemetry and trail singletons the live link
 * writes into. There is no marker on a pushed sample saying which producer it
 * came from, so every entry point that writes those stores refuses while any
 * vehicle link is managed: loading, playing, seeking and resuming.
 *
 * @module telemetry-player
 * @license GPL-3.0-only
 */

import { loadRecordingFrames, listRecordings } from "@/lib/telemetry-recorder";
import type { TelemetryFrame, TelemetryRecording } from "@/lib/telemetry-recorder";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore } from "@/stores/trail-store";
import { useDroneManager } from "@/stores/drone-manager";

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
  // Imported logs (tlog, ULog) record the fix as globalPosition.
  globalPosition: "pushPosition",
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

/**
 * Why replay may not write the telemetry stores right now, or null when it
 * may. Any managed vehicle blocks it, whatever its connection or arm state:
 * an armed drone and a drone whose link dropped both still own the stores.
 */
export function replayBlockedReason(): string | null {
  const { drones, selectedDroneId } = useDroneManager.getState();
  if (selectedDroneId === null && drones.size === 0) return null;
  return "Disconnect every vehicle before replaying: playback and live telemetry share one store, and interleaving them renders a recording as live flight data";
}

function assertReplayAllowed(): void {
  const reason = replayBlockedReason();
  if (reason) throw new Error(reason);
}

function dispatchFrame(frame: TelemetryFrame): void {
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
  // The map trail is fed by the live bridge, not by the telemetry store;
  // replay feeds it from the recorded position frames the same way.
  if (method === "pushPosition") pushTrailPoint(frame.data);
}

function pushTrailPoint(data: unknown): void {
  const d = data as { lat?: unknown; lon?: unknown; relativeAlt?: unknown };
  if (typeof d.lat !== "number" || typeof d.lon !== "number") return;
  if (d.lat === 0 && d.lon === 0) return;
  useTrailStore.getState().pushPoint(d.lat, d.lon, typeof d.relativeAlt === "number" ? d.relativeAlt : 0);
}

/** Empty the stores replay writes, so a fresh position starts clean. */
function clearReplayStores(): void {
  useTelemetryStore.getState().clear();
  useTrailStore.getState().clear();
}

/**
 * Core playback loop driven by requestAnimationFrame.
 * Dispatches all frames whose offsetMs falls within the current playback time.
 */
function tick(): void {
  if (_state !== "playing") return;
  // A vehicle managed mid-playback owns the stores from this frame on.
  if (replayBlockedReason() !== null) {
    pause();
    return;
  }

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
 * Refuses while a vehicle link is managed; otherwise clears the telemetry and
 * trail stores to start fresh.
 */
export async function loadPlayback(recordingId: string): Promise<void> {
  assertReplayAllowed();
  // Stop any active playback
  if (_state !== "stopped") stop();

  const frames = await loadRecordingFrames(recordingId);
  if (frames.length === 0) {
    throw new Error(`No frames found for recording ${recordingId}`);
  }
  // A vehicle may have connected while the frames were loading.
  assertReplayAllowed();

  _frames = frames;
  // Ensure frames are sorted by offset (should already be, but defensive)
  _frames.sort((a, b) => a.offsetMs - b.offsetMs);

  _recordingId = recordingId;
  _totalDurationMs = _frames[_frames.length - 1].offsetMs;
  _frameIndex = 0;
  _playStartOffset = 0;
  _state = "stopped";

  clearReplayStores();

  emitChange();
}

/**
 * Stop playback and release the recording. Clears the replayed samples from
 * the telemetry and trail stores, unless a vehicle link has taken them over
 * in the meantime (its data is live, not the recording's).
 */
export function unloadPlayback(): void {
  const hadRecording = _recordingId !== null;
  stop();
  _frames = [];
  _recordingId = null;
  _totalDurationMs = 0;
  if (hadRecording && replayBlockedReason() === null) clearReplayStores();
  emitChange();
}

/**
 * Start playback from the beginning.
 *
 * Refuses while a vehicle link is managed: with both running the rings would
 * interleave a recorded flight with the aircraft in front of the operator,
 * and every consumer downstream (the HUD, the cockpit band, the analyser)
 * reads the result as current.
 */
export function play(): void {
  if (_frames.length === 0) {
    throw new Error("No recording loaded — call loadPlayback() first");
  }
  assertReplayAllowed();
  // Reset to start
  _frameIndex = 0;
  _playStartOffset = 0;
  _playStartWall = performance.now();
  _state = "playing";

  clearReplayStores();
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
 * Resume playback from paused position. Refuses while a vehicle link is
 * managed, like {@link play}.
 */
export function resume(): void {
  if (_state !== "paused") return;
  assertReplayAllowed();

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
 * Re-dispatches the most recent frame per channel up to the seek point, and
 * rebuilds the trail from every position up to it, so the UI reflects the
 * correct state at that time. Refuses while a vehicle link is managed.
 */
export function seek(offsetMs: number): void {
  if (_frames.length === 0) return;
  assertReplayAllowed();

  const clampedOffset = Math.max(0, Math.min(offsetMs, _totalDurationMs));
  const wasPlaying = _state === "playing";

  // Pause the RAF loop while we seek
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }

  // Clear the replay stores for a clean seek
  clearReplayStores();

  // Find the frame index at the seek point
  _frameIndex = 0;
  while (_frameIndex < _frames.length && _frames[_frameIndex].offsetMs <= clampedOffset) {
    _frameIndex++;
  }

  // Replay the last frame per channel up to this point so the UI shows
  // correct values at the seek position. The trail is a path, so every
  // position up to the seek point goes back in (the trail store drops the
  // repeat when the last one is dispatched again below).
  const lastPerChannel = new Map<string, TelemetryFrame>();
  for (let i = 0; i < _frameIndex; i++) {
    const frame = _frames[i];
    lastPerChannel.set(frame.channel, frame);
    if (CHANNEL_DISPATCH[frame.channel] === "pushPosition") pushTrailPoint(frame.data);
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
