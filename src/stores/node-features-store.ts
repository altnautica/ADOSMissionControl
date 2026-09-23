/**
 * @module node-features-store
 * @description Per-node record of which first-party features the operator has
 * turned ON for a given node, keyed by the bare device id. First-party features
 * (World Model / Atlas today) are native, powerful, and NON-mandatory: a drone
 * ships lean and the operator opts a feature in per node with the Status-tab
 * Features toggle. This store is that opt-in state.
 *
 * It is the drone-side analogue of the retired global Atlas flag — but per node,
 * so one drone can run the World Model while another does not. It also gates the
 * feature's polling (a drone only polls its Atlas readiness once the feature is
 * enabled), so a lean fleet does no Atlas work until asked.
 *
 * The agent remains the source of truth for whether the native service is
 * actually running (read from its readiness inside the feature surface, no fabricated reading);
 * this store is the operator's per-node intent that reveals the feature and
 * bootstraps the poll. Persisted, SSR/test-safe, mirrors `local-nodes-store` /
 * `local-plugin-installs-store`.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/** A no-op storage for SSR / test environments where a usable localStorage is
 * absent (some test DOM shims expose a `window.localStorage` whose methods are
 * undefined), so we feature-detect the methods, not just `window`. */
const NOOP_STORAGE = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function resolveStorage() {
  if (typeof window === "undefined") return NOOP_STORAGE;
  const ls = window.localStorage as unknown as
    | { getItem?: unknown; setItem?: unknown; removeItem?: unknown }
    | undefined;
  if (
    ls &&
    typeof ls.getItem === "function" &&
    typeof ls.setItem === "function" &&
    typeof ls.removeItem === "function"
  ) {
    return window.localStorage;
  }
  return NOOP_STORAGE;
}

interface NodeFeaturesState {
  /** Enabled feature ids per bare device id. */
  enabled: Record<string, string[]>;
  /** Whether `featureId` is enabled for `deviceId`. */
  isEnabled: (deviceId: string, featureId: string) => boolean;
  /** Turn `featureId` on/off for `deviceId`. */
  setEnabled: (deviceId: string, featureId: string, on: boolean) => void;
  /** The enabled feature ids for one node. */
  listForNode: (deviceId: string) => string[];
  /** Drop all features for a node (e.g. on unpair). */
  removeNode: (deviceId: string) => void;
  /** Drop every record (operator reset). */
  clear: () => void;
}

export const useNodeFeaturesStore = create<NodeFeaturesState>()(
  persist(
    (set, get) => ({
      enabled: {},
      isEnabled: (deviceId, featureId) =>
        (get().enabled[deviceId] ?? []).includes(featureId),
      setEnabled: (deviceId, featureId, on) =>
        set((s) => {
          const current = s.enabled[deviceId] ?? [];
          const has = current.includes(featureId);
          if (on === has) return s;
          const nextForNode = on
            ? [...current, featureId]
            : current.filter((f) => f !== featureId);
          const next = { ...s.enabled };
          if (nextForNode.length > 0) next[deviceId] = nextForNode;
          else delete next[deviceId];
          return { enabled: next };
        }),
      listForNode: (deviceId) => get().enabled[deviceId] ?? [],
      removeNode: (deviceId) =>
        set((s) => {
          if (!(deviceId in s.enabled)) return s;
          const next = { ...s.enabled };
          delete next[deviceId];
          return { enabled: next };
        }),
      clear: () => set({ enabled: {} }),
    }),
    {
      name: "altcmd:node-features",
      storage: createJSONStorage(resolveStorage),
      version: 1,
      migrate: (persisted) => persisted as NodeFeaturesState,
    },
  ),
);
