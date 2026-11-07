/**
 * @module mission/mission-state
 * @description The one mission state every surface reads: `none`, `loaded`,
 * `active`, `paused`, `complete` or `returning`. An agent-connected drone
 * computes it on the drone and publishes it as `mission` (state.v5 and the
 * `pilot` nav kind); a direct-serial flight controller has no agent, so this
 * module runs the same rules here over the link's own HEARTBEAT custom_mode,
 * MISSION_CURRENT and MISSION_ITEM_REACHED. Modes are compared by number,
 * never by name.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import type { FirmwareType } from "@/lib/protocol/types";

export type MissionStateKind = "none" | "loaded" | "active" | "paused" | "complete" | "returning";

/** The C8 `mission` object (camelCase, as every MC parser carries it). */
export interface MissionStatus {
  state: MissionStateKind;
  seq: number;
  total: number;
  itemReached: number | null;
  id: number | null;
  source: "mission_state" | "fallback";
  ageMs: number;
  landingSeq: boolean;
}

/** MISSION_STATE enum values. */
const MS = { unknown: 0, noMission: 1, notStarted: 2, active: 3, paused: 4, complete: 5 } as const;
/** MISSION_CURRENT is trusted for `mission_state` only while younger than this. */
export const MISSION_CURRENT_FRESH_MS = 3000;

type Family = "copter" | "plane" | "px4" | "other";

function family(fw: FirmwareType | undefined): Family {
  if (fw === "ardupilot-copter") return "copter";
  if (fw === "ardupilot-plane") return "plane";
  if (fw === "px4") return "px4";
  return "other";
}

/** PX4 main mode in bits 16–23, sub mode in bits 24–31. */
function px4Modes(customMode: number): [number, number] {
  return [(customMode >>> 16) & 0xff, (customMode >>> 24) & 0xff];
}

export function inAuto(fw: FirmwareType | undefined, customMode: number): boolean {
  switch (family(fw)) {
    case "copter":
      return customMode === 3 || customMode === 27;
    case "plane":
      return customMode === 10;
    case "px4": {
      const [main, sub] = px4Modes(customMode);
      return main === 4 && sub === 4;
    }
    default:
      return false;
  }
}

export function isHoldMode(fw: FirmwareType | undefined, customMode: number): boolean {
  switch (family(fw)) {
    case "copter":
      return customMode === 5 || customMode === 16 || customMode === 17;
    case "plane":
      return customMode === 12 || customMode === 19;
    case "px4": {
      const [main, sub] = px4Modes(customMode);
      return main === 4 && sub === 3;
    }
    default:
      return false;
  }
}

export function isReturnMode(fw: FirmwareType | undefined, customMode: number): boolean {
  switch (family(fw)) {
    case "copter":
      return customMode === 6 || customMode === 21 || customMode === 9;
    case "plane":
      return customMode === 11 || customMode === 21 || customMode === 20;
    default:
      return false;
  }
}

/** Everything the direct-link computation reads, per drone. */
export interface MissionInputs {
  firmware: FirmwareType | undefined;
  armed: boolean;
  customMode: number | null;
  seq: number;
  /** MISSION_CURRENT `total`, or the plan length the GCS holds when the FC sends none. */
  total: number;
  missionState: number | null;
  missionCurrentAt: number | null;
  id: number | null;
  itemReached: number | null;
  /** ArduPilot DO_PAUSE_CONTINUE pause accepted and not yet cleared. */
  apPause: boolean;
  /** `active` seen this arm cycle. */
  latched: boolean;
  /** `complete` reached; held until disarm or a new plan. */
  completeLatched: boolean;
}

export const EMPTY_INPUTS: MissionInputs = {
  firmware: undefined,
  armed: false,
  customMode: null,
  seq: 0,
  total: 0,
  missionState: null,
  missionCurrentAt: null,
  id: null,
  itemReached: null,
  apPause: false,
  latched: false,
  completeLatched: false,
};

/**
 * The C8 rules, first match wins. Pure: returns the status and the tracker
 * fields the result updates (`latched`, `completeLatched`).
 */
export function computeMissionState(
  i: MissionInputs,
  now: number,
): { status: MissionStatus; latched: boolean; completeLatched: boolean } {
  const fresh = i.missionCurrentAt !== null && now - i.missionCurrentAt < MISSION_CURRENT_FRESH_MS;
  const S = fresh && i.missionState !== null && i.missionState !== MS.unknown ? i.missionState : null;
  const mode = i.customMode ?? -1;
  const auto = i.customMode !== null && inAuto(i.firmware, mode);
  const landingSeq = family(i.firmware) === "copter" && mode === 27;
  let latched = i.latched;
  let completeLatched = i.completeLatched;

  const base = {
    seq: i.seq,
    total: i.total,
    itemReached: i.itemReached,
    id: i.id,
    source: S !== null ? ("mission_state" as const) : ("fallback" as const),
    ageMs: i.missionCurrentAt === null ? Number.POSITIVE_INFINITY : Math.max(0, now - i.missionCurrentAt),
    landingSeq,
  };
  const out = (state: MissionStateKind) => ({
    status: { ...base, state },
    latched,
    completeLatched,
  });

  if (S === MS.noMission || i.total === 0 || i.total === 0xffff) {
    return { status: { ...base, state: "none" }, latched: false, completeLatched: false };
  }
  if (
    S === MS.complete ||
    completeLatched ||
    (latched && i.itemReached !== null && i.itemReached === i.total - 1)
  ) {
    completeLatched = true;
    return out("complete");
  }
  if (latched && i.customMode !== null && isReturnMode(i.firmware, mode)) return out("returning");
  if (i.armed && auto && !i.apPause && (S === MS.active || (S === null && i.seq >= 1))) {
    latched = true;
    return out("active");
  }
  if (
    i.armed &&
    (S === MS.paused ||
      (auto && i.apPause) ||
      (latched && i.customMode !== null && isHoldMode(i.firmware, mode)))
  ) {
    return out("paused");
  }
  return out("loaded");
}

interface MissionStateStore {
  inputs: Record<string, MissionInputs>;
  status: Record<string, MissionStatus>;
  /** Merge new link observations for one drone and recompute. */
  observe: (droneId: string, patch: Partial<MissionInputs>, now?: number) => void;
  clear: (droneId: string) => void;
}

export const useMissionStateStore = create<MissionStateStore>((set, get) => ({
  inputs: {},
  status: {},
  observe: (droneId, patch, now = Date.now()) => {
    const prev = get().inputs[droneId] ?? EMPTY_INPUTS;
    const next: MissionInputs = { ...prev, ...patch };
    // Disarm ends the arm cycle; a mode or seq change clears a pause; a new
    // plan (total or non-zero id changed) clears the latches.
    if (prev.armed && !next.armed) {
      next.latched = false;
      next.completeLatched = false;
      next.apPause = false;
    }
    if (prev.customMode !== next.customMode || prev.seq !== next.seq) next.apPause = patch.apPause ?? false;
    if (prev.total !== next.total || (next.id !== null && next.id !== 0 && prev.id !== next.id)) {
      next.latched = false;
      next.completeLatched = false;
    }
    const r = computeMissionState(next, now);
    next.latched = r.latched;
    next.completeLatched = r.completeLatched;
    set((s) => ({
      inputs: { ...s.inputs, [droneId]: next },
      status: { ...s.status, [droneId]: r.status },
    }));
  },
  clear: (droneId) =>
    set((s) => {
      const inputs = { ...s.inputs };
      const status = { ...s.status };
      delete inputs[droneId];
      delete status[droneId];
      return { inputs, status };
    }),
}));

/**
 * Pick the mission status to show: the drone's own (agent-computed) value
 * when one is present, else this link's computation.
 */
export function selectMissionStatus(
  agent: MissionStatus | null | undefined,
  direct: MissionStatus | null | undefined,
): MissionStatus | null {
  return agent ?? direct ?? null;
}
