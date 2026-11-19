/**
 * @module reconstruct-stream-store
 * @description Per-drone state of the Reconstruct compute node's live stream
 * (`lib/api/reconstruct/world-stream`): which node streams, whether its
 * socket is live, and the node's sweep cloud for the Map tab's 3D view. A
 * drone with no compute node has no entry.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import {
  applyVoxelDelta,
  emptySweepCloud,
  type SweepCloud,
} from "@/components/drone-detail/map/sweep-cloud";
import type { LiveCloudFrame, WorldStreamState } from "@/lib/api/reconstruct/world-stream";

export interface ReconstructStreamEntry {
  /** The compute node's device id. */
  nodeId: string;
  state: WorldStreamState;
  /** The node's sweep cloud since this browser connected. */
  cloud: SweepCloud;
  /** Bumped whenever `cloud` changes. */
  version: number;
}

interface ReconstructStreamState {
  byDrone: Record<string, ReconstructStreamEntry>;
  /** A node change starts from an empty cloud. */
  setStatus: (droneId: string, nodeId: string, state: WorldStreamState) => void;
  applyCloud: (droneId: string, frame: LiveCloudFrame) => void;
  clear: (droneId: string) => void;
}

export const useReconstructStreamStore = create<ReconstructStreamState>()((set) => ({
  byDrone: {},
  setStatus: (droneId, nodeId, state) =>
    set((s) => {
      const held = s.byDrone[droneId];
      if (held && held.nodeId === nodeId && held.state === state) return s;
      const entry: ReconstructStreamEntry =
        held && held.nodeId === nodeId
          ? { ...held, state }
          : { nodeId, state, cloud: emptySweepCloud(), version: (held?.version ?? 0) + 1 };
      return { byDrone: { ...s.byDrone, [droneId]: entry } };
    }),
  applyCloud: (droneId, frame) =>
    set((s) => {
      const held = s.byDrone[droneId];
      if (!held) return s;
      const entry = { ...held, cloud: applyVoxelDelta(held.cloud, frame), version: held.version + 1 };
      return { byDrone: { ...s.byDrone, [droneId]: entry } };
    }),
  clear: (droneId) =>
    set((s) => {
      if (!(droneId in s.byDrone)) return s;
      const byDrone = { ...s.byDrone };
      delete byDrone[droneId];
      return { byDrone };
    }),
}));
