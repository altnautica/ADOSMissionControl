/**
 * @module simulation-store
 * @description Zustand store for mission simulation playback state.
 * Manages playback controls, camera mode, and elapsed time.
 * Clock-backed: all time advancement driven by CesiumJS Clock,
 * synced back to store via syncFromClock() for HUD/controls.
 * Non-persisted — resets on page reload.
 *
 * Decoupled from CesiumJS: the store never imports "cesium" at runtime.
 * All viewer/clock operations are delegated through callback functions
 * supplied by bindSimViewer(). This keeps cesium out of shared chunks.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export type PlaybackState = "stopped" | "playing" | "paused";
export type CameraMode = "topdown" | "follow" | "orbit" | "free";

/** Position synced from CesiumJS 3D entity each tick (authoritative for HUD). */
export interface SyncedPosition {
  lat: number;
  lon: number;
  altAgl: number;
  heading: number;
  speed: number;
  waypointIndex: number;
}

interface SimulationStoreState {
  playbackState: PlaybackState;
  playbackSpeed: number;
  elapsed: number;
  totalDuration: number;
  cameraMode: CameraMode;
  /** ID of the library plan being simulated (for plan-to-simulate tracking). */
  sourceLibraryPlanId: string | null;
  /** Position synced from 3D entity — null until first tick with resolved positions. */
  syncedPosition: SyncedPosition | null;
  /** Whether follow camera heading is locked to flight heading. */
  followHeadingLocked: boolean;

  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  stepForward: () => void;
  stepBack: () => void;
  setSpeed: (speed: number) => void;
  setCameraMode: (mode: CameraMode) => void;
  setTotalDuration: (duration: number) => void;
  setSourcePlanId: (id: string | null) => void;
  syncFromClock: () => void;
  syncPosition: (pos: SyncedPosition) => void;
  toggleFollowHeading: () => void;
  reset: () => void;
}

const STEP_SECONDS = 1;

/** Quantize to 3 decimal places — matches syncFromClock precision */
const quantize = (v: number) => Math.round(v * 1000) / 1000;

// ── Viewer bridge ──────────────────────────────────────────────────────
// Instead of importing CesiumJS, the store delegates all viewer/clock
// operations through these callback functions, set by bindSimViewer().

/** Callbacks that encapsulate all CesiumJS viewer operations. */
export interface SimViewerBridge {
  /** Seek the CesiumJS clock to the given elapsed seconds. */
  seekClock: (seconds: number) => void;
  /** Request a render frame. */
  requestRender: () => void;
  /** Set clock.shouldAnimate. */
  setAnimate: (animate: boolean) => void;
  /** Set clock.multiplier. */
  setMultiplier: (multiplier: number) => void;
  /** Set clock.stopTime from elapsed seconds. */
  setStopTime: (totalDuration: number) => void;
  /** Read elapsed seconds from the clock (secondsDifference from start). */
  getElapsed: () => number;
  /** Read clock.shouldAnimate. */
  getShouldAnimate: () => boolean;
  /** Check if the viewer is still alive (not destroyed). */
  isAlive: () => boolean;
}

// Module-level bridge binding (viewer objects are not serializable in Zustand)
let _bridge: SimViewerBridge | null = null;
/** Opaque viewer reference used only for identity checks in unbind. */
let _viewerRef: unknown = null;

export function bindSimViewer(viewer: unknown, bridge: SimViewerBridge) {
  if (_viewerRef === viewer) return; // Already bound to this viewer
  _viewerRef = viewer;
  _bridge = bridge;
}

export function unbindSimViewer(viewer?: unknown) {
  if (viewer && _viewerRef !== viewer) return; // Different viewer, don't unbind
  _viewerRef = null;
  _bridge = null;
}

function seekClock(seconds: number) {
  if (_bridge && _bridge.isAlive()) {
    _bridge.seekClock(seconds);
  }
}

export const useSimulationStore = create<SimulationStoreState>()((set, get) => ({
  playbackState: "stopped",
  playbackSpeed: 1,
  elapsed: 0,
  totalDuration: 0,
  cameraMode: "topdown",
  sourceLibraryPlanId: null,
  syncedPosition: null,
  followHeadingLocked: true,

  play: () => {
    if (!_bridge || !_bridge.isAlive()) return;
    const { elapsed, totalDuration } = get();
    // If at the end, restart from beginning
    if (elapsed >= totalDuration && totalDuration > 0) {
      set({ playbackState: "playing", elapsed: 0 });
      seekClock(0);
    } else {
      set({ playbackState: "playing" });
    }
    _bridge.setAnimate(true);
  },

  pause: () => {
    set({ playbackState: "paused" });
    if (_bridge && _bridge.isAlive()) {
      _bridge.setAnimate(false);
    }
  },

  stop: () => {
    set({ playbackState: "stopped", elapsed: 0 });
    if (_bridge && _bridge.isAlive()) {
      _bridge.setAnimate(false);
    }
    seekClock(0);
  },

  seek: (time) => {
    const { totalDuration } = get();
    const clamped = quantize(Math.max(0, Math.min(time, totalDuration)));
    set({ elapsed: clamped });
    seekClock(clamped);
  },

  stepForward: () => {
    const { elapsed, totalDuration } = get();
    if (totalDuration === 0) return;
    const next = quantize(Math.min(elapsed + STEP_SECONDS, totalDuration));
    set({ elapsed: next });
    seekClock(next);
  },

  stepBack: () => {
    const { elapsed, totalDuration } = get();
    if (totalDuration === 0) return;
    const prev = quantize(Math.max(elapsed - STEP_SECONDS, 0));
    set({ elapsed: prev });
    seekClock(prev);
  },

  setSpeed: (playbackSpeed) => {
    set({ playbackSpeed });
    if (_bridge && _bridge.isAlive()) {
      _bridge.setMultiplier(playbackSpeed);
    }
  },

  setCameraMode: (cameraMode) => set({ cameraMode }),

  setSourcePlanId: (sourceLibraryPlanId) => set({ sourceLibraryPlanId }),

  syncPosition: (syncedPosition) => set({ syncedPosition }),

  toggleFollowHeading: () => set((s) => ({ followHeadingLocked: !s.followHeadingLocked })),

  setTotalDuration: (totalDuration) => {
    set({ totalDuration });
    if (_bridge && _bridge.isAlive()) {
      _bridge.setStopTime(totalDuration);
    }
  },

  syncFromClock: () => {
    if (!_bridge || !_bridge.isAlive()) return;
    const elapsed = _bridge.getElapsed();
    const { totalDuration, playbackState, elapsed: current } = get();
    const clamped = quantize(Math.max(0, Math.min(elapsed, totalDuration)));

    // Detect CesiumJS auto-stop (ClockRange.CLAMPED stops clock at stopTime)
    if (playbackState === "playing" && !_bridge.getShouldAnimate()) {
      set({ elapsed: clamped, playbackState: "paused" });
    } else if (clamped !== current) {
      set({ elapsed: clamped });
    }
  },

  reset: () => {
    set({
      playbackState: "stopped",
      playbackSpeed: 1,
      elapsed: 0,
      totalDuration: 0,
      cameraMode: "topdown",
      sourceLibraryPlanId: null,
      syncedPosition: null,
      followHeadingLocked: true,
    });
    if (_bridge && _bridge.isAlive()) {
      _bridge.setAnimate(false);
      _bridge.setMultiplier(1);
    }
    seekClock(0);
  },
}));
