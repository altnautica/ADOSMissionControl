"use client";

/**
 * @module atlas-store
 * @description Focused-drone Atlas world-model capture telemetry: the
 * during-flight Live World state (capture session, ingest stats, the paired
 * reconstructor, and the active transport bearer). Mirrors the focused-agent
 * shape of the compute store — one slice for the drone currently mapped by the
 * status bridge. These are the drone's own capture facts; reconstruction metrics
 * (gaussian count, training rate) live on the compute node's World Model surface,
 * not here.
 *
 * Fed by the cloud-relay heartbeat fan-out in `CloudStatusBridge` (via
 * `buildAtlasPatch`). The slice stays empty (every field null) until a
 * capturing drone reports `atlas*` fields, so the Live World view renders an
 * "awaiting capture" state otherwise.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** A drone's live Atlas capture state. Every field is null until a capturing
 * heartbeat populates it. */
export interface AtlasLiveState {
  /** "idle" | "capturing" | "ready" | "active" | "paused" | "ended" | "error". */
  state: string | null;
  sessionId: string | null;
  keyframesIngested: number | null;
  ingestRateHz: number | null;
  /** Enabled cameras (1 to N) for the capture rig. */
  cameraCount: number | null;
  /** VIO/tracking health: "good" | "degraded" | "lost". */
  vioHealth: string | null;
  /** The paired reconstructor (compute node) deviceId. */
  computeNodeId: string | null;
  /** Epoch ms of the last keyframe. */
  lastKfAt: number | null;
  /** The active world-model bearer: "direct-lan" | "wfb-relay" | "cloud". */
  bearer: string | null;
  /** Whether the ACTIVE bearer can carry a full keyframe, as the agent's own
   * contract decides it. `false` means the world-model lane is degraded to pose
   * and status — i.e. NO world model — while the bearer still reads as live, so
   * without this the Stream card showed a working transport and produced
   * nothing. Null when the agent reported no bearer, where there is nothing
   * honest to claim either way. */
  keyframesCarried: boolean | null;
  /** True once the session-wide keyframe cap stopped selection: the capture is
   * still `capturing` and the count is frozen on purpose, which is otherwise
   * indistinguishable from a stalled camera. */
  capped: boolean | null;
  /** True once the session's geo anchor latched. Keyframe selection is refused
   * before it, so a capture with `anchored: false` is running and producing
   * nothing. */
  anchored: boolean | null;
  /** Which producer filled the pose being tagged ("local_vio" |
   * "offloaded_slam" | "hybrid"), so a silent switch to offloaded SLAM is
   * visible rather than inferred. */
  poseTier: string | null;
  /** Keyframes the capture path produced but the bus could not deliver, so the
   * ingested count is not read as reconstruction input that exists. */
  droppedKeyframes: number | null;
  /** The ground agent relaying WFB<->LAN, when bearer = "wfb-relay". */
  relayGroundAgentId: string | null;
  /** Keyframe decimation on the relay lane (1 = none). */
  relayDecimation: number | null;
  /** Epoch ms of the heartbeat this slice was last populated from, or null. */
  updatedAt: number | null;
}

export const EMPTY_ATLAS_LIVE: AtlasLiveState = {
  state: null,
  sessionId: null,
  keyframesIngested: null,
  ingestRateHz: null,
  cameraCount: null,
  vioHealth: null,
  computeNodeId: null,
  lastKfAt: null,
  bearer: null,
  keyframesCarried: null,
  capped: null,
  anchored: null,
  poseTier: null,
  droppedKeyframes: null,
  relayGroundAgentId: null,
  relayDecimation: null,
  updatedAt: null,
};

interface AtlasStoreState {
  live: AtlasLiveState;
  /** Replace the live slice (the bridge passes a fully-merged slice). */
  setLive: (live: AtlasLiveState) => void;
  /** Reset to the empty slice (connection reset). */
  clear: () => void;
}

export const useAtlasStore = create<AtlasStoreState>((set) => ({
  live: { ...EMPTY_ATLAS_LIVE },
  setLive: (live) => set({ live }),
  clear: () => set({ live: { ...EMPTY_ATLAS_LIVE } }),
}));
