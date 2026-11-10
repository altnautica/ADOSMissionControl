/**
 * @module checklist-store
 * @description Zustand store for pre-flight checklist state: the spec
 * checklist (`@/lib/cockpit/preflight`) that gates the first arm, and the
 * auto-verified telemetry and manual pilot items of the detailed list.
 *
 * A session belongs to one drone. Readiness is only ever reported for the drone
 * the session was started for, and `selectDrone` resets the session, so a
 * checklist passed on one aircraft never vouches for another. The first arm
 * follows the spec rule: the operator passes the checklist once no item
 * fails (warnings are accepted by passing), and later arms of the session
 * go ahead directly. `ChecklistAutoRunner` writes the items from fresh
 * telemetry whether or not a checklist is open.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { AutoCheckId, AutoCheckVerdicts } from "@/lib/checklist/auto-checks";
import { firstArmAllowed, type PreflightItem } from "@/lib/cockpit/preflight";

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
  { id: "pilot-readiness", category: "software", label: "ADOS Pilot ready", description: "Every pilot readiness item is green (FC profile, position estimate, height source)", type: "auto" },
  { id: "link-fresh", category: "software", label: "Link live", description: "Flight controller heartbeat is fresh", type: "auto" },
  { id: "controller", category: "hardware", label: "Controller connected", description: "Needed when ADOS Pilot flies the sticks", type: "auto" },
  { id: "storage", category: "hardware", label: "Storage free", description: "Drone storage below 95% full", type: "auto" },

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
  /** When the operator passed the spec checklist this session, else null. */
  completedAt: number | null;
  /** The spec checklist for the session's drone; null before the first evaluation. */
  preflight: PreflightItem[] | null;

  /** Open a fresh session (every item pending) for `droneId`. */
  startSession: (droneId: string) => void;
  resetSession: () => void;
  toggleManualItem: (id: string) => void;
  /**
   * Write the auto items' verdicts. A pending verdict keeps an operator skip; a
   * measured pass or fail always replaces it.
   */
  applyAutoVerdicts: (verdicts: AutoCheckVerdicts) => void;
  /** Write the spec checklist for `droneId`; ignored for any other drone. */
  setPreflightItems: (droneId: string, items: PreflightItem[]) => void;
  /**
   * The operator passes the spec checklist for `droneId`. Refused (false)
   * while the session is another drone's, the items are not evaluated yet, or
   * an item fails.
   */
  passPreflight: (droneId: string) => boolean;
  /** Skip a manual item, or an auto item while it has no verdict. Toggles. */
  skipItem: (id: string) => void;
  /** Whether the open session belongs to `droneId` and its checklist was passed. */
  isReadyToArm: (droneId: string | null) => boolean;
  getProgress: () => { total: number; checked: number; failed: number };
  getCategoryProgress: (category: ChecklistCategory) => { total: number; checked: number; failed: number };
}

function isDone(item: ChecklistItem): boolean {
  return item.status === "pass" || item.status === "skipped";
}

/**
 * Selector-friendly readiness, the first-arm gate: true only when the session
 * was started for `droneId` and the operator passed its checklist.
 */
export function checklistReadyFor(
  state: Pick<ChecklistStoreState, "droneId" | "completedAt">,
  droneId: string | null,
): boolean {
  return droneId !== null && state.droneId === droneId && state.completedAt !== null;
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
  preflight: null,

  startSession: (droneId) => {
    set({
      items: freshItems(),
      droneId,
      sessionId: crypto.randomUUID(),
      startedAt: Date.now(),
      completedAt: null,
      preflight: null,
    });
  },

  resetSession: () => {
    set({
      items: freshItems(),
      droneId: null,
      sessionId: null,
      startedAt: null,
      completedAt: null,
      preflight: null,
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

  setPreflightItems: (droneId, items) => {
    const { droneId: owner, preflight } = get();
    if (owner !== droneId) return;
    // Re-evaluated on every telemetry push: skip the write when nothing moved.
    if (
      preflight &&
      preflight.length === items.length &&
      preflight.every((p, i) => p.id === items[i].id && p.state === items[i].state && p.label === items[i].label)
    ) {
      return;
    }
    set({ preflight: items });
  },

  passPreflight: (droneId) => {
    const { droneId: owner, preflight } = get();
    if (owner !== droneId || preflight === null || !firstArmAllowed(preflight)) return false;
    set({ completedAt: Date.now() });
    return true;
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
