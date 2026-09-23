/**
 * @module checklist-store
 * @description Zustand store for pre-flight checklist state. Manages auto-verified
 * telemetry checks and manual pilot confirmation items. Provides go/no-go status
 * for arming.
 *
 * A session belongs to one drone. Readiness is only ever reported for the drone
 * the session was started for, and `selectDrone` resets the session, so a
 * checklist completed on one aircraft never vouches for another. Auto items are
 * written by `ChecklistAutoRunner` from fresh telemetry whether or not the
 * checklist modal is open.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { AutoCheckId, AutoCheckVerdicts } from "@/lib/checklist/auto-checks";

export type ChecklistCategory = "hardware" | "software" | "environment" | "mission";
export type ChecklistItemType = "auto" | "manual";
export type ChecklistItemStatus = "pending" | "pass" | "fail" | "skipped";

export interface ChecklistItem {
  id: string;
  category: ChecklistCategory;
  label: string;
  description?: string;
  type: ChecklistItemType;
  status: ChecklistItemStatus;
  /** Display string for auto-check current value (e.g. "78%", "12 sats") */
  displayValue?: string;
}

/** Default checklist items. Order within category is display order. */
const DEFAULT_ITEMS: Omit<ChecklistItem, "status" | "displayValue">[] = [
  // Hardware
  { id: "battery-level", category: "hardware", label: "Battery charged", description: "Battery remaining > 20%", type: "auto" },
  { id: "battery-voltage", category: "hardware", label: "Battery voltage OK", description: "At least 3.7 V per cell", type: "auto" },
  { id: "props-secured", category: "hardware", label: "Props secured", description: "All propellers tightened and undamaged", type: "manual" },
  { id: "frame-intact", category: "hardware", label: "Frame intact", description: "No visible cracks or loose parts", type: "manual" },
  { id: "motors-free", category: "hardware", label: "Motors free to spin", description: "No obstructions on any motor", type: "manual" },

  // Software
  { id: "gps-fix", category: "software", label: "GPS lock acquired", description: "3D fix or better", type: "auto" },
  { id: "gps-sats", category: "software", label: "GPS satellites sufficient", description: "At least 8 satellites visible", type: "auto" },
  { id: "ekf-ok", category: "software", label: "EKF status OK", description: "EKF variance within limits", type: "auto" },
  { id: "sensors-healthy", category: "software", label: "Sensor health OK", description: "All present sensors reporting healthy", type: "auto" },
  { id: "prearm-pass", category: "software", label: "Firmware pre-arm pass", description: "No PreArm failures from FC", type: "auto" },

  // Environment
  { id: "wind-ok", category: "environment", label: "Wind conditions acceptable", description: "Wind speed within vehicle limits", type: "manual" },
  { id: "airspace-clear", category: "environment", label: "Airspace clear", description: "No manned aircraft or restricted zones", type: "manual" },
  { id: "launch-area-clear", category: "environment", label: "Launch area clear", description: "No people or obstacles in takeoff path", type: "manual" },
  { id: "observers-briefed", category: "environment", label: "Observers briefed", description: "All nearby personnel aware of flight", type: "manual" },

  // Mission
  { id: "flight-plan", category: "mission", label: "Flight plan loaded", description: "Mission waypoints uploaded or confirmed", type: "auto" },
  { id: "geofence-set", category: "mission", label: "Geofence set", description: "Geofence enabled with appropriate limits", type: "auto" },
  { id: "rtl-point", category: "mission", label: "Return-to-launch set", description: "RTL point confirmed and safe", type: "manual" },
  { id: "emergency-reviewed", category: "mission", label: "Emergency procedures reviewed", description: "Pilot knows abort, RTL, and kill procedures", type: "manual" },
];

interface ChecklistStoreState {
  items: ChecklistItem[];
  /** The drone this session was started for; null when no session is open. */
  droneId: string | null;
  sessionId: string | null;
  startedAt: number | null;
  completedAt: number | null;

  /** Open a fresh session (every item pending) for `droneId`. */
  startSession: (droneId: string) => void;
  resetSession: () => void;
  toggleManualItem: (id: string) => void;
  /**
   * Write the auto items' verdicts. A pending verdict keeps an operator skip; a
   * measured pass or fail always replaces it.
   */
  applyAutoVerdicts: (verdicts: AutoCheckVerdicts) => void;
  /** Skip a manual item, or an auto item while it has no verdict. Toggles. */
  skipItem: (id: string) => void;
  /** Whether the open session belongs to `droneId` and every item is done. */
  isReadyToArm: (droneId: string | null) => boolean;
  getProgress: () => { total: number; checked: number; failed: number };
  getCategoryProgress: (category: ChecklistCategory) => { total: number; checked: number; failed: number };
}

function isDone(item: ChecklistItem): boolean {
  return item.status === "pass" || item.status === "skipped";
}

/**
 * Selector-friendly readiness: true only when the session was started for
 * `droneId` and every item is passed or skipped.
 */
export function checklistReadyFor(
  state: Pick<ChecklistStoreState, "droneId" | "items">,
  droneId: string | null,
): boolean {
  return droneId !== null && state.droneId === droneId && state.items.every(isDone);
}

function freshItems(): ChecklistItem[] {
  return DEFAULT_ITEMS.map((item) => ({ ...item, status: "pending" as const }));
}

export const useChecklistStore = create<ChecklistStoreState>((set, get) => ({
  items: freshItems(),
  droneId: null,
  sessionId: null,
  startedAt: null,
  completedAt: null,

  startSession: (droneId) => {
    set({
      items: freshItems(),
      droneId,
      sessionId: crypto.randomUUID(),
      startedAt: Date.now(),
      completedAt: null,
    });
  },

  resetSession: () => {
    set({
      items: freshItems(),
      droneId: null,
      sessionId: null,
      startedAt: null,
      completedAt: null,
    });
  },

  toggleManualItem: (id) => {
    set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id || item.type !== "manual") return item;
        return {
          ...item,
          status: item.status === "pass" ? "pending" : "pass",
        };
      }),
    }));
  },

  applyAutoVerdicts: (verdicts) => {
    const { items } = get();
    let changed = false;
    const next = items.map((item): ChecklistItem => {
      if (item.type !== "auto") return item;
      const verdict = verdicts[item.id as AutoCheckId];
      if (!verdict) return item;
      const status: ChecklistItemStatus =
        verdict.status === "pending" && item.status === "skipped" ? "skipped" : verdict.status;
      if (status === item.status && verdict.displayValue === item.displayValue) return item;
      changed = true;
      return { ...item, status, displayValue: verdict.displayValue };
    });
    if (changed) set({ items: next });
  },

  skipItem: (id) => {
    set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;
        // A measured auto verdict is not the operator's to override.
        if (item.type === "auto" && item.status !== "pending" && item.status !== "skipped") {
          return item;
        }
        return { ...item, status: item.status === "skipped" ? "pending" : "skipped" };
      }),
    }));
  },

  isReadyToArm: (droneId) => checklistReadyFor(get(), droneId),

  getProgress: () => {
    const { items } = get();
    return {
      total: items.length,
      checked: items.filter(isDone).length,
      failed: items.filter((i) => i.status === "fail").length,
    };
  },

  getCategoryProgress: (category) => {
    const items = get().items.filter((i) => i.category === category);
    return {
      total: items.length,
      checked: items.filter(isDone).length,
      failed: items.filter((i) => i.status === "fail").length,
    };
  },
}));
