/**
 * @module mcp-follow-store
 * @description Follow-Lock state for the MCP activity watch. `followLock` (the
 * persisted opt-in) governs whether the GCS auto-navigates to the surface each
 * MCP tool touches; the rest is ephemeral follow state the bridge sets so the
 * indicator (border + "Following MCP" banner) and the feed row flash stay in
 * sync. Default OFF — auto-navigation never surprises the operator until they
 * opt in. Isolated from settings-store so there is no migration coupling.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface McpFollowState {
  /** Persisted opt-in: when on, the bridge auto-navigates + spotlights. */
  followLock: boolean;
  /** Display label of the node currently being followed (ephemeral). */
  followingNode: string | null;
  /** Feed row id to flash briefly on arrival (ephemeral). */
  flashId: string | null;
  /** Monotonic marker bumped on each auto-nav arrival, to trigger the pulse. */
  arrivedAt: number;

  setFollowLock: (v: boolean) => void;
  toggleFollowLock: () => void;
  /** Bridge sets the followed node + bumps the arrival marker. */
  arrive: (node: string | null, flashId: string | null) => void;
  clearFlash: () => void;
}

export const useMcpFollowStore = create<McpFollowState>()(
  persist(
    (set) => ({
      followLock: false,
      followingNode: null,
      flashId: null,
      arrivedAt: 0,

      setFollowLock: (followLock) =>
        set(followLock ? { followLock } : { followLock, followingNode: null }),
      toggleFollowLock: () =>
        set((s) => (s.followLock ? { followLock: false, followingNode: null } : { followLock: true })),
      arrive: (followingNode, flashId) =>
        set((s) => ({ followingNode, flashId, arrivedAt: s.arrivedAt + 1 })),
      clearFlash: () => set({ flashId: null }),
    }),
    {
      name: "altcmd:mcp-follow",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            },
      ),
      // Only the opt-in persists; the live follow state resets each load.
      partialize: (s) => ({ followLock: s.followLock }),
      version: 1,
      migrate: (persisted) => persisted as McpFollowState,
    },
  ),
);
