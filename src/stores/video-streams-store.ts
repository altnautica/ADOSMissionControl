/**
 * @module VideoStreamsStore
 * @description Per-drone store of the video STREAMS a node exposes, so the
 * cockpit can show a stream switcher (top-left `1..N` tabs) and a
 * picture-in-picture inset whenever a node has more than one camera / video
 * source. This is separate from the single-slot `video-store` (which owns the
 * live transport, stats, and the one active WHEP session): the streams store
 * decides *which* stream address feeds that transport, `video-store` drives it.
 *
 * One {@link StreamDescriptor} normalizes every source into one shape with two
 * switch mechanisms so the cockpit UI is identical for all of them:
 *   - `concurrent`  — the agent exposes N addressable WHEP paths (one mediamtx
 *     path per camera). Selecting one re-points the video cascade at that leg's
 *     WHEP URL and forces a re-offer → an instant client-side flip. PiP is
 *     possible (a second player renders a second concurrent leg).
 *   - `switchable`  — one encoder, N cameras behind it. Selecting one calls the
 *     agent's `switchCamera` (the encoder restarts, ~3s) with an optimistic
 *     "switching…" state. Works on any multi-camera node today; PiP disabled.
 *
 * The single universal auto-detect condition for showing the switcher is
 * `streams.length > 1` (from either population source — per-leg `access_urls`
 * for `concurrent`, or `CameraCapability[]` / `listCameras()` for `switchable`).
 *
 * Population and the selection side effects (switchCamera / re-point) live in
 * the bridge/hook, not here — this store is pure state (per the store checklist)
 * keyed by drone id, mirroring the per-(model,camera) keying in
 * `vision-detections-store`.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** How a stream is switched to, which decides the selection side effect and
 * whether it can appear in a PiP inset. */
export type StreamSwitchKind = "concurrent" | "switchable";

/** Logical sensor role, drives the tab label + glyph. Open string so a novel
 * role from a future source still renders (falls back to the camera name). */
export type StreamRole = "eo" | "eo_wide" | "ir" | "split" | (string & {});

/** i18n key suffix (namespace `cockpitStreams`) for a known role's short tab
 * label. An unknown role has no entry → the tab renders the descriptor's raw
 * `label` (the camera name) instead. */
export const ROLE_LABEL_KEY: Readonly<Record<string, string>> = {
  eo: "roleEo",
  eo_wide: "roleEoWide",
  ir: "roleIr",
  split: "roleSplit",
};

/** One selectable video stream a node exposes. */
export interface StreamDescriptor {
  /** Stable per-drone stream id: an `access_url.id` (concurrent), a device
   * path (switchable), or a synthesized id. The switcher key. */
  id: string;
  /** 1-based position → the hotkey digit and the tab order. */
  index: number;
  /** Raw display label (camera name), the fallback when `role` is unknown. */
  label: string;
  /** Logical sensor role, drives the localized tab label when known. */
  role?: StreamRole;
  /** Which switch mechanism applies. */
  kind: StreamSwitchKind;
  /** `concurrent` only: the addressable WHEP leg to re-point the cascade at. */
  address?: {
    /** mediamtx path, e.g. `"eo-zoom/whep"`. */
    whepPath: string;
    /** Fully-resolved WHEP URL against the agent LAN host, when known. */
    whepUrl?: string;
    codec?: "h264" | "h265";
  };
  /** `switchable` only: the device the agent switches the encoder to. */
  devicePath?: string;
  /** Agent-sampled per-leg liveness: `false` = a known-dead leg (rendered
   * disabled, never auto-selected / re-pointed to); `true` = live; absent/`null`
   * = not-yet-sampled or an idle on-demand secondary — treated as selectable,
   * never dead. */
  live?: boolean | null;
}

interface VideoStreamsState {
  /** The stream list per drone (device id). `length > 1` shows the switcher. */
  streamsByDrone: Record<string, StreamDescriptor[]>;
  /** The active (main-view) stream id per drone. `null` = default to the first. */
  activeStreamIdByDrone: Record<string, string | null>;
  /** The picture-in-picture stream id per drone, or `null` when PiP is off. */
  pipStreamIdByDrone: Record<string, string | null>;
  /** Optimistic "switching…" flag while a `switchable` encoder restarts. */
  switchingByDrone: Record<string, boolean>;

  /** Replace a drone's stream list. Keeps the active id if it still exists,
   * else defaults the active to the first stream (or `null` when empty). */
  setStreams: (droneId: string, streams: StreamDescriptor[]) => void;
  /** Select the main-view stream by id or 1-based index. No-op when the target
   * does not exist. Does NOT perform the transport side effect (the hook does). */
  selectStream: (droneId: string, idOrIndex: string | number) => void;
  /** Advance the active stream by `dir` (+1 / -1), wrapping. */
  cycleStream: (droneId: string, dir: number) => void;
  /** Set (or clear with `null`) the PiP stream. */
  setPip: (droneId: string, id: string | null) => void;
  /** Set the optimistic switching flag (a `switchable` restart in flight). */
  setSwitching: (droneId: string, switching: boolean) => void;

  /** A drone's streams (empty when none). */
  streamsForDrone: (droneId: string) => StreamDescriptor[];
  /** The active stream descriptor, or the first stream when unset, else null. */
  activeStream: (droneId: string) => StreamDescriptor | null;
  /** The PiP stream descriptor, or null. */
  pipStream: (droneId: string) => StreamDescriptor | null;

  /** Drop a drone's streams (on disconnect / focus change away). */
  clearForDevice: (droneId: string) => void;
  /** Reset everything. */
  clear: () => void;
}

/** Resolve `idOrIndex` (a stream id or a 1-based index) to a stream id present
 * in `streams`, or `null`. */
function resolveId(
  streams: StreamDescriptor[],
  idOrIndex: string | number,
): string | null {
  if (typeof idOrIndex === "number") {
    return streams[idOrIndex - 1]?.id ?? null;
  }
  return streams.some((s) => s.id === idOrIndex) ? idOrIndex : null;
}

/** Set the active stream for a drone. A PiP must always show a DIFFERENT stream
 * than the main view, so when the newly-selected main is the one the PiP was
 * showing, the PiP moves to another concurrent leg (or hides when there is no
 * other candidate) — otherwise the inset would duplicate the main feed. */
function withActive(
  state: VideoStreamsState,
  droneId: string,
  streams: StreamDescriptor[],
  id: string,
): Partial<VideoStreamsState> {
  const activeStreamIdByDrone = {
    ...state.activeStreamIdByDrone,
    [droneId]: id,
  };
  const pip = state.pipStreamIdByDrone[droneId] ?? null;
  if (pip == null || pip !== id) return { activeStreamIdByDrone };
  const alt = streams.find((s) => s.id !== id && s.kind === "concurrent");
  return {
    activeStreamIdByDrone,
    pipStreamIdByDrone: {
      ...state.pipStreamIdByDrone,
      [droneId]: alt?.id ?? null,
    },
  };
}

export const useVideoStreamsStore = create<VideoStreamsState>((set, get) => ({
  streamsByDrone: {},
  activeStreamIdByDrone: {},
  pipStreamIdByDrone: {},
  switchingByDrone: {},

  setStreams: (droneId, streams) =>
    set((state) => {
      // The same invariant selectStream enforces: a known-dead leg is never
      // made the main view while a selectable one exists. The previous active
      // leg survives a refresh unless it has since been reported dead.
      const selectable = (s: StreamDescriptor) => s.live !== false;
      const prevActive = state.activeStreamIdByDrone[droneId] ?? null;
      const prevActiveStream = streams.find((s) => s.id === prevActive);
      const firstLive = streams.find(selectable);
      const nextActive =
        prevActiveStream && (selectable(prevActiveStream) || !firstLive)
          ? prevActiveStream.id
          : (firstLive ?? streams[0])?.id ?? null;
      // A PiP must show a different, live leg; otherwise it hides.
      const prevPip = state.pipStreamIdByDrone[droneId] ?? null;
      const pipStream = streams.find((s) => s.id === prevPip);
      const nextPip =
        pipStream && selectable(pipStream) && pipStream.id !== nextActive ? pipStream.id : null;
      return {
        streamsByDrone: { ...state.streamsByDrone, [droneId]: streams },
        activeStreamIdByDrone: {
          ...state.activeStreamIdByDrone,
          [droneId]: nextActive,
        },
        pipStreamIdByDrone: { ...state.pipStreamIdByDrone, [droneId]: nextPip },
      };
    }),

  // A known-dead leg (`live === false`) is never made the main view, whichever
  // input asked: a tab click, a digit hotkey, backtick or the D-pad.
  selectStream: (droneId, idOrIndex) =>
    set((state) => {
      const streams = state.streamsByDrone[droneId] ?? [];
      const id = resolveId(streams, idOrIndex);
      if (id == null || id === state.activeStreamIdByDrone[droneId]) return state;
      if (streams.find((s) => s.id === id)?.live === false) return state;
      return withActive(state, droneId, streams, id);
    }),

  cycleStream: (droneId, dir) =>
    set((state) => {
      const streams = state.streamsByDrone[droneId] ?? [];
      if (streams.length <= 1) return state;
      const activeId = state.activeStreamIdByDrone[droneId] ?? streams[0]?.id;
      const cur = Math.max(
        0,
        streams.findIndex((s) => s.id === activeId),
      );
      const len = streams.length;
      // Step past dead legs; a full lap with no live candidate is a no-op.
      for (let step = 1; step < len; step++) {
        const next = streams[((cur + dir * step) % len + len) % len];
        if (!next || next.live === false) continue;
        if (next.id === activeId) return state;
        return withActive(state, droneId, streams, next.id);
      }
      return state;
    }),

  setPip: (droneId, id) =>
    set((state) => ({
      pipStreamIdByDrone: { ...state.pipStreamIdByDrone, [droneId]: id },
    })),

  setSwitching: (droneId, switching) =>
    set((state) => ({
      switchingByDrone: { ...state.switchingByDrone, [droneId]: switching },
    })),

  streamsForDrone: (droneId) => get().streamsByDrone[droneId] ?? [],

  activeStream: (droneId) => {
    const streams = get().streamsByDrone[droneId] ?? [];
    if (streams.length === 0) return null;
    const activeId = get().activeStreamIdByDrone[droneId];
    return streams.find((s) => s.id === activeId) ?? streams[0] ?? null;
  },

  pipStream: (droneId) => {
    const streams = get().streamsByDrone[droneId] ?? [];
    const pipId = get().pipStreamIdByDrone[droneId];
    if (pipId == null) return null;
    return streams.find((s) => s.id === pipId) ?? null;
  },

  clearForDevice: (droneId) =>
    set((state) => {
      if (
        !(droneId in state.streamsByDrone) &&
        !(droneId in state.activeStreamIdByDrone) &&
        !(droneId in state.pipStreamIdByDrone) &&
        !(droneId in state.switchingByDrone)
      ) {
        return state;
      }
      const streamsByDrone = { ...state.streamsByDrone };
      delete streamsByDrone[droneId];
      const activeStreamIdByDrone = { ...state.activeStreamIdByDrone };
      delete activeStreamIdByDrone[droneId];
      const pipStreamIdByDrone = { ...state.pipStreamIdByDrone };
      delete pipStreamIdByDrone[droneId];
      const switchingByDrone = { ...state.switchingByDrone };
      delete switchingByDrone[droneId];
      return {
        streamsByDrone,
        activeStreamIdByDrone,
        pipStreamIdByDrone,
        switchingByDrone,
      };
    }),

  clear: () =>
    set({
      streamsByDrone: {},
      activeStreamIdByDrone: {},
      pipStreamIdByDrone: {},
      switchingByDrone: {},
    }),
}));
