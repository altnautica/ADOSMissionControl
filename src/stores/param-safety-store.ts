import { create } from "zustand";
import { RingBuffer } from "@/lib/ring-buffer";
import { isCriticalParam } from "@/lib/protocol/critical-params";

const DEFAULT_STALE_MS = 5 * 60 * 1000; // 5 minutes

interface PendingWrite {
  panel: string;
  paramName: string;
  oldValue: number;
  newValue: number;
  timestamp: number;
}

interface FlashCommitEntry {
  timestamp: number;
  paramCount: number;
  success: boolean;
}

interface ParamSafetyStoreState {
  pendingWrites: Map<string, PendingWrite>;
  flashCommitLog: RingBuffer<FlashCommitEntry>;
  lastFlashCommit: number;
  panelStaleness: Map<string, number>;
  rebootRequiredParams: Set<string>;

  trackWrite: (paramName: string, oldValue: number, newValue: number, panel: string) => void;
  removeWrite: (paramName: string) => void;
  commitFlash: (success?: boolean) => void;
  getPendingCount: () => number;
  hasCriticalPending: () => boolean;
  markPanelLoaded: (panel: string) => void;
  isPanelStale: (panel: string, maxAgeMs?: number) => boolean;
  trackRebootParam: (paramName: string) => void;
  clearRebootParams: () => void;
  clear: () => void;
}

export const useParamSafetyStore = create<ParamSafetyStoreState>((set, get) => ({
  pendingWrites: new Map(),
  flashCommitLog: new RingBuffer<FlashCommitEntry>(10),
  lastFlashCommit: 0,
  panelStaleness: new Map(),
  rebootRequiredParams: new Set(),

  trackWrite: (paramName, oldValue, newValue, panel) => {
    const pending = new Map(get().pendingWrites);
    pending.set(paramName, {
      panel,
      paramName,
      oldValue,
      newValue,
      timestamp: Date.now(),
    });
    set({ pendingWrites: pending });
  },

  removeWrite: (paramName) => {
    const pending = new Map(get().pendingWrites);
    pending.delete(paramName);
    set({ pendingWrites: pending });
  },

  commitFlash: (success = true) => {
    const s = get();
    s.flashCommitLog.push({
      timestamp: Date.now(),
      paramCount: s.pendingWrites.size,
      success,
    });
    // A new Map, so every subscriber (the flash banner, the disconnect guard)
    // sees the pending set empty after a commit from any panel.
    set({ pendingWrites: new Map(), lastFlashCommit: Date.now() });
  },

  getPendingCount: () => get().pendingWrites.size,

  hasCriticalPending: () => {
    for (const paramName of get().pendingWrites.keys()) {
      if (isCriticalParam(paramName)) return true;
    }
    return false;
  },

  markPanelLoaded: (panel) => {
    const staleness = new Map(get().panelStaleness);
    staleness.set(panel, Date.now());
    set({ panelStaleness: staleness });
  },

  isPanelStale: (panel, maxAgeMs = DEFAULT_STALE_MS) => {
    const loaded = get().panelStaleness.get(panel);
    if (loaded === undefined) return true;
    return Date.now() - loaded > maxAgeMs;
  },

  trackRebootParam: (paramName: string) => {
    const reboot = new Set(get().rebootRequiredParams);
    reboot.add(paramName);
    set({ rebootRequiredParams: reboot });
  },

  clearRebootParams: () => {
    set({ rebootRequiredParams: new Set() });
  },

  clear: () =>
    set({
      pendingWrites: new Map(),
      flashCommitLog: new RingBuffer<FlashCommitEntry>(10),
      lastFlashCommit: 0,
      panelStaleness: new Map(),
      rebootRequiredParams: new Set(),
    }),
}));
