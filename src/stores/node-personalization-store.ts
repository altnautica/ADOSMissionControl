/**
 * @module node-personalization-store
 * @description The operator-owned, per-browser PRESENTATION OVERLAY for a fleet
 * of look-alike nodes: a tile colour, a display label, an alternate icon /
 * initials, a custom badge, an opt-in set of feature dots, plus pin / group /
 * mute flags. Keyed by the stable `deviceId` (the same identity the sidebar rows
 * and `local-nodes-store` use) so a re-flashed or re-paired box keeps its look.
 *
 * This overlay is PURE PRESENTATION. It is resolved at render only and NEVER
 * gates connection, pairing, or status logic — removing this store must not
 * change what a node reports, only how it looks. Health/status tokens stay
 * reserved: a node the operator paints red still shows a green `good` ring and a
 * red `critical` badge correctly (identity can never mask a fault).
 *
 * Local-first, per-browser v1: stored in localStorage only; a cloud
 * mirror is secondary / opt-in / deferred. The same plaintext, per-origin
 * threat-model caveat as `local-nodes-store` applies.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { NodeSwatch } from "@/lib/nodes/node-profile";
import { asSignalKey, type FeatureDot } from "@/lib/nodes/node-feature-dots";

/** The operator's presentation overlay for one node (keyed by `deviceId`). */
export interface NodePersonalization {
  /** Named theme-safe swatch; absent = the profile's default accent. */
  color?: NodeSwatch;
  /** Display label; overrides the shown name (not the node's identity). */
  label?: string;
  /** Alternate glyph key or 1-2 char initials rendered over the type wash. */
  icon?: string;
  /** Whether this node floats to the top of the sidebar list. */
  pinned?: boolean;
  /** A named group the operator assigns this node to. */
  group?: string;
  /** A short (<=6 char) operator badge shown on the row. */
  badge?: string;
  /** The ordered, opt-in feature dots the operator pinned onto this node. */
  dots?: FeatureDot[];
  /** Suppress this node's alert attention (presentation only). */
  muted?: boolean;
}

interface NodePersonalizationState {
  /** The overlay per stable `deviceId`. A node with no overlay has no key. */
  byNode: Record<string, NodePersonalization>;
  setColor: (deviceId: string, color: NodeSwatch | undefined) => void;
  setLabel: (deviceId: string, label: string | undefined) => void;
  setIcon: (deviceId: string, icon: string | undefined) => void;
  setPinned: (deviceId: string, pinned: boolean) => void;
  setGroup: (deviceId: string, group: string | undefined) => void;
  setBadge: (deviceId: string, badge: string | undefined) => void;
  setDots: (deviceId: string, dots: FeatureDot[] | undefined) => void;
  setMuted: (deviceId: string, muted: boolean) => void;
  /** Clear every overlay field for this node (leaves no orphan entry). */
  reset: (deviceId: string) => void;
  /** Non-reactive read of one node's overlay. */
  get: (deviceId: string) => NodePersonalization | undefined;
}

/**
 * Merge a patch into a node's overlay and prune it back to nothing when the
 * result carries no meaningful value — a `false` flag, an empty string, or an
 * empty array all count as absent, so clearing a field leaves no orphan overlay
 * (which would otherwise read as "this node is personalized").
 */
function patchNode(
  byNode: Record<string, NodePersonalization>,
  deviceId: string,
  patch: Partial<NodePersonalization>,
): Record<string, NodePersonalization> {
  const merged: NodePersonalization = { ...(byNode[deviceId] ?? {}), ...patch };
  (Object.keys(merged) as (keyof NodePersonalization)[]).forEach((key) => {
    const value = merged[key];
    if (
      value === undefined ||
      value === "" ||
      value === false ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete merged[key];
    }
  });
  const next = { ...byNode };
  if (Object.keys(merged).length === 0) {
    delete next[deviceId];
  } else {
    next[deviceId] = merged;
  }
  return next;
}

export const useNodePersonalizationStore = create<NodePersonalizationState>()(
  persist(
    (set, get) => ({
      byNode: {},
      setColor: (deviceId, color) =>
        set((s) => ({ byNode: patchNode(s.byNode, deviceId, { color }) })),
      setLabel: (deviceId, label) =>
        set((s) => ({
          byNode: patchNode(s.byNode, deviceId, { label: label?.trim() }),
        })),
      setIcon: (deviceId, icon) =>
        set((s) => ({
          byNode: patchNode(s.byNode, deviceId, {
            icon: icon?.trim().slice(0, 2).toUpperCase(),
          }),
        })),
      setPinned: (deviceId, pinned) =>
        set((s) => ({ byNode: patchNode(s.byNode, deviceId, { pinned }) })),
      setGroup: (deviceId, group) =>
        set((s) => ({
          byNode: patchNode(s.byNode, deviceId, { group: group?.trim() }),
        })),
      setBadge: (deviceId, badge) =>
        set((s) => ({
          byNode: patchNode(s.byNode, deviceId, {
            badge: badge?.trim().slice(0, 6),
          }),
        })),
      setDots: (deviceId, dots) =>
        set((s) => ({ byNode: patchNode(s.byNode, deviceId, { dots }) })),
      setMuted: (deviceId, muted) =>
        set((s) => ({ byNode: patchNode(s.byNode, deviceId, { muted }) })),
      reset: (deviceId) =>
        set((s) => {
          if (!s.byNode[deviceId]) return s;
          const next = { ...s.byNode };
          delete next[deviceId];
          return { byNode: next };
        }),
      get: (deviceId) => get().byNode[deviceId],
    }),
    {
      name: "altcmd:node-personalization",
      version: 2,
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            },
      ),
      // v2 narrowed the pinnable signals to the ones a node can verify; dots
      // pinned to a retired signal are dropped rather than rendered.
      migrate: (persisted, version) => {
        const state = persisted as Pick<NodePersonalizationState, "byNode">;
        if (version >= 2 || !state?.byNode) return state as NodePersonalizationState;
        let byNode = state.byNode;
        for (const [deviceId, overlay] of Object.entries(state.byNode)) {
          if (!overlay.dots) continue;
          const dots = overlay.dots.filter((d) => asSignalKey(d.signal) !== null);
          byNode = patchNode(byNode, deviceId, { dots });
        }
        return { ...state, byNode } as NodePersonalizationState;
      },
    },
  ),
);

/**
 * Non-reactive resolver for a node's presentation overlay. Use inside event
 * handlers / imperative code; components should subscribe with a selector
 * (`useNodePersonalizationStore((s) => s.byNode[deviceId])`) so a change to one
 * node never re-renders the others.
 */
export function resolvePersonalization(
  deviceId: string,
): NodePersonalization | undefined {
  return useNodePersonalizationStore.getState().byNode[deviceId];
}
