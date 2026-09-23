/**
 * @module dronecan/node-store
 * @description Zustand store for DroneCAN node presence and rolling status.
 *
 * Each known node tracks `lastSeen` (epoch ms), the most recent NodeStatus,
 * the most recent GetNodeInfo response (when known), and a 60-entry rolling
 * status history. A 1Hz internal tick sweeps entries older than 10s out of
 * the map. Nodes with `lastSeen` within the last 3s count as online.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { NodeStatus } from "@/lib/dronecan/dsdl/node-status";
import type { GetNodeInfoResponse } from "@/lib/dronecan/dsdl/get-node-info";

export type { NodeStatus, GetNodeInfoResponse };

export interface NodeEntry {
  nodeId: number;
  lastSeen: number;
  nodeInfo?: GetNodeInfoResponse;
  lastStatus?: NodeStatus;
  statusHistory: NodeStatus[];
}

const STATUS_HISTORY_CAP = 60;
/** A node heard from within this window counts as online. */
export const NODE_ONLINE_WINDOW_MS = 3_000;
const STALE_WINDOW_MS = 10_000;
const SWEEP_INTERVAL_MS = 1_000;

interface NodeStoreState {
  nodes: Map<number, NodeEntry>;
  _version: number;
  _tickTimer: ReturnType<typeof setInterval> | null;
  _subscriberCount: number;

  upsertStatus: (nodeId: number, status: NodeStatus) => void;
  setNodeInfo: (nodeId: number, info: GetNodeInfoResponse) => void;
  clear: () => void;
  clearStale: () => void;

  getOnlineCount: () => number;
  getNode: (nodeId: number) => NodeEntry | undefined;
  getNodeIds: () => number[];
  isOnline: (nodeId: number) => boolean;

  /** Increment subscriber refcount; first subscriber starts the sweep tick. */
  _acquire: () => void;
  /** Decrement subscriber refcount; last subscriber stops the sweep tick. */
  _release: () => void;
}

export const useDroneCanNodeStore = create<NodeStoreState>((set, get) => ({
  nodes: new Map(),
  _version: 0,
  _tickTimer: null,
  _subscriberCount: 0,

  upsertStatus: (nodeId, status) => {
    const state = get();
    const existing = state.nodes.get(nodeId);
    const history = existing ? existing.statusHistory.slice() : [];
    history.push(status);
    if (history.length > STATUS_HISTORY_CAP) {
      history.splice(0, history.length - STATUS_HISTORY_CAP);
    }
    const next: NodeEntry = {
      nodeId,
      lastSeen: Date.now(),
      nodeInfo: existing?.nodeInfo,
      lastStatus: status,
      statusHistory: history,
    };
    const map = new Map(state.nodes);
    map.set(nodeId, next);
    set({ nodes: map, _version: state._version + 1 });
  },

  setNodeInfo: (nodeId, info) => {
    const state = get();
    const existing = state.nodes.get(nodeId);
    const next: NodeEntry = {
      nodeId,
      lastSeen: existing?.lastSeen ?? Date.now(),
      nodeInfo: info,
      lastStatus: existing?.lastStatus,
      statusHistory: existing?.statusHistory ?? [],
    };
    const map = new Map(state.nodes);
    map.set(nodeId, next);
    set({ nodes: map, _version: state._version + 1 });
  },

  clear: () => {
    set({ nodes: new Map(), _version: get()._version + 1 });
  },

  clearStale: () => {
    const state = get();
    const cutoff = Date.now() - STALE_WINDOW_MS;
    let removed = 0;
    const map = new Map(state.nodes);
    for (const [id, entry] of map) {
      if (entry.lastSeen < cutoff) {
        map.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      set({ nodes: map, _version: state._version + 1 });
    }
  },

  getOnlineCount: () => {
    const cutoff = Date.now() - NODE_ONLINE_WINDOW_MS;
    let count = 0;
    for (const entry of get().nodes.values()) {
      if (entry.lastSeen >= cutoff) count++;
    }
    return count;
  },

  getNode: (nodeId) => get().nodes.get(nodeId),

  getNodeIds: () => Array.from(get().nodes.keys()).sort((a, b) => a - b),

  isOnline: (nodeId) => {
    const entry = get().nodes.get(nodeId);
    if (!entry) return false;
    return entry.lastSeen >= Date.now() - NODE_ONLINE_WINDOW_MS;
  },

  _acquire: () => {
    const state = get();
    const nextCount = state._subscriberCount + 1;
    if (state._tickTimer === null && nextCount > 0) {
      const timer = setInterval(() => {
        get().clearStale();
      }, SWEEP_INTERVAL_MS);
      set({ _subscriberCount: nextCount, _tickTimer: timer });
    } else {
      set({ _subscriberCount: nextCount });
    }
  },

  _release: () => {
    const state = get();
    const nextCount = Math.max(0, state._subscriberCount - 1);
    if (nextCount === 0 && state._tickTimer !== null) {
      clearInterval(state._tickTimer);
      set({ _subscriberCount: 0, _tickTimer: null });
    } else {
      set({ _subscriberCount: nextCount });
    }
  },
}));
