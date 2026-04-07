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

/**
 * Maps recording channel names to telemetry store push methods.
 * Channels not in this map are silently skipped during playback.
 */
const CHANNEL_DISPATCH: Record<string, (data: unknown) => void> = {
  attitude:      (d) => useTelemetryStore.getState().pushAttitude(d as Parameters<ReturnType<typeof useTelemetryStore.getState>["pushAttitude"]>[0]),
  position:      (d) => useTelemetryStore.getState().pushPosition(d as any),
  battery:       (d) => useTelemetryStore.getState().pushBattery(d as any),
  gps:           (d) => useTelemetryStore.getState().pushGps(d as any),
  radio:         (d) => useTelemetryStore.getState().pushRadio(d as any),
  rc:            (d) => useTelemetryStore.getState().pushRc(d as any),
  vfr:           (d) => useTelemetryStore.getState().pushVfr(d as any),
  sysStatus:     (d) => useTelemetryStore.getState().pushSysStatus(d as any),
  ekf:           (d) => useTelemetryStore.getState().pushEkf(d as any),
  vibration:     (d) => useTelemetryStore.getState().pushVibration(d as any),
  servoOutput:   (d) => useTelemetryStore.getState().pushServoOutput(d as any),
  wind:          (d) => useTelemetryStore.getState().pushWind(d as any),
  terrain:       (d) => useTelemetryStore.getState().pushTerrain(d as any),
  localPosition: (d) => useTelemetryStore.getState().pushLocalPosition(d as any),
  debug:         (d) => useTelemetryStore.getState().pushDebug(d as any),
  gimbal:        (d) => useTelemetryStore.getState().pushGimbal(d as any),
  obstacle:      (d) => useTelemetryStore.getState().pushObstacle(d as any),
  // heartbeat — update drone store last-heartbeat timestamp
  heartbeat:     () => useDroneStore.getState().heartbeat(),
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

/** Optional listener notified on every state change. */
let _onChange: ((status: PlaybackStatus) => void) | null = null;

// ── Internal Helpers ─────────────────────────────────────────

function currentTimeMs(): number {
  if (_state === "playing") {
    const elapsed = (performance.now() - _playStartWall) * _speed;
    return Math.min(_playStartOffset + elapsed, _totalDurationMs);
  }
  return _playStartOffset;
}

function emitChange(): void {
  _onChange?.(getPlaybackState());
}

function dispatchFrame(frame: TelemetryFrame): void {
  const handler = CHANNEL_DISPATCH[frame.channel];
  if (handler) handler(frame.data);
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
 */
export function play(): void {
  if (_frames.length === 0) {
    throw new Error("No recording loaded — call loadPlayback() first");
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
export function onPlaybackChange(cb: (status: PlaybackStatus) => void): () => void {
  _onChange = cb;
  return () => {
    if (_onChange === cb) _onChange = null;
  };
}

/**
 * Check if a recording is loaded and ready for playback.
 */
export function isLoaded(): boolean {
  return _frames.length > 0 && _recordingId !== null;
}
