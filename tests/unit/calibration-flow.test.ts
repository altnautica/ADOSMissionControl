/**
 * Calibration state-machine coverage — the accel terminal-STATUSTEXT completion,
 * the compass MAG_CAL stall/finalize path, the PX4 [cal] stall path, and an
 * independently-derived CRC_EXTRA lock for MAG_CAL_PROGRESS / MAG_CAL_REPORT.
 *
 * These paths had zero coverage; on real hardware the accel cal hung at the final
 * step (bare "Calibration successful" dropped by the keyword gate) and the compass
 * cal looped forever (safety timeout reset on every progress frame). The demo mock
 * drove completion through channels the real firmware does not use, so it masked
 * both defects — hence direct unit coverage of the subscription state machine.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { subscribeToCalibrationStatus } from "@/components/fc/calibration/calibration-subscriptions";
import { subscribePx4CalStatus } from "@/components/fc/calibration/px4-cal-parser";
import { INITIAL_STATE } from "@/components/fc/calibration/calibration-types";
import type { CalibrationState } from "@/components/fc/calibration/calibration-types";
import type { SubsManager } from "@/components/fc/calibration/cal-sub-helpers";
import { crc16Accumulate, CRC_EXTRA } from "@/lib/protocol/mavlink-parser";
import type { DroneProtocol } from "@/lib/protocol/types";

// ── Fakes ──

type Emit = Record<string, ((data: unknown) => void)[]>;

function makeProtocol() {
  const cbs: Emit = { status: [], magProgress: [], magReport: [], attitude: [], accelPos: [] };
  const reg = (k: string) => (cb: (data: unknown) => void) => {
    cbs[k].push(cb);
    return () => { const i = cbs[k].indexOf(cb); if (i >= 0) cbs[k].splice(i, 1); };
  };
  const protocol = {
    onStatusText: reg("status"),
    onMagCalProgress: reg("magProgress"),
    onMagCalReport: reg("magReport"),
    onAttitude: reg("attitude"),
    onAccelCalPos: reg("accelPos"),
  } as unknown as DroneProtocol;
  const emit = (k: string, data: unknown) => cbs[k].slice().forEach((cb) => cb(data));
  return { protocol, emit };
}

function makeState(overrides: Partial<CalibrationState> = {}) {
  let state: CalibrationState = { ...INITIAL_STATE, status: "in_progress", ...overrides };
  const setter = ((u: React.SetStateAction<CalibrationState>) => {
    state = typeof u === "function" ? (u as (p: CalibrationState) => CalibrationState)(state) : u;
  }) as React.Dispatch<React.SetStateAction<CalibrationState>>;
  return { get: () => state, setter };
}

function makeManager(): SubsManager {
  return {
    subsRef: { current: new Map() },
    timeoutRef: { current: new Map() },
  } as SubsManager;
}

const notify = () => {};
const fullMask = () => new Array(10).fill(0xff);
const goodReport = (compassId: number, calStatus: number, autosaved = 0) => ({
  compassId, calStatus, autosaved,
  ofsX: 10, ofsY: -5, ofsZ: 20, fitness: 5,
  diagX: 1, diagY: 1, diagZ: 1, offdiagX: 0, offdiagY: 0, offdiagZ: 0,
  orientationConfidence: 1, oldOrientation: 0, newOrientation: 0, scaleFactor: 1,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

// ── Accelerometer ──

describe("accelerometer terminal STATUSTEXT (ArduPilot)", () => {
  it("completes on the bare 'Calibration successful' (no accel keyword)", () => {
    const { protocol, emit } = makeProtocol();
    const { get, setter } = makeState();
    subscribeToCalibrationStatus(makeManager(), protocol, setter, 6, "accel", notify, false);

    emit("accelPos", { position: 6 });        // last position confirmed
    emit("status", { severity: 6, text: "Calibration successful" });

    expect(get().status).toBe("success");
    expect(get().currentStep).toBe(6);
    expect(get().progress).toBe(100);
  });

  it("fails on the bare 'Calibration FAILED'", () => {
    const { protocol, emit } = makeProtocol();
    const { get, setter } = makeState();
    subscribeToCalibrationStatus(makeManager(), protocol, setter, 6, "accel", notify, false);

    emit("status", { severity: 3, text: "Calibration FAILED" });
    expect(get().status).toBe("error");
  });

  it("does not let a compass-named terminal complete the accel cal", () => {
    const { protocol, emit } = makeProtocol();
    const { get, setter } = makeState();
    subscribeToCalibrationStatus(makeManager(), protocol, setter, 6, "accel", notify, false);

    emit("status", { severity: 6, text: "Compass calibration successful" });
    expect(get().status).toBe("in_progress");
  });
});

// ── Compass ──

describe("compass MAG_CAL completion + stall (ArduPilot)", () => {
  it("completes to waiting_accept once every compass reports", () => {
    const { protocol, emit } = makeProtocol();
    const { get, setter } = makeState();
    subscribeToCalibrationStatus(makeManager(), protocol, setter, 1, "compass", notify, false);

    emit("magProgress", { compassId: 0, completionPct: 100, calStatus: 3, completionMask: fullMask() });
    emit("magProgress", { compassId: 1, completionPct: 100, calStatus: 3, completionMask: fullMask() });
    emit("magReport", goodReport(0, 4));
    emit("magReport", goodReport(1, 4));

    expect(get().status).toBe("waiting_accept");
    expect(get().progress).toBe(100);
  });

  it("surfaces a failing report immediately as cal_warning (not gated)", () => {
    const { protocol, emit } = makeProtocol();
    const { get, setter } = makeState();
    subscribeToCalibrationStatus(makeManager(), protocol, setter, 1, "compass", notify, false);

    emit("magProgress", { compassId: 0, completionPct: 100, calStatus: 3, completionMask: fullMask() });
    emit("magReport", goodReport(0, 6)); // BAD_ORIENTATION

    expect(get().status).toBe("cal_warning");
  });

  it("finalizes to waiting_accept when a sibling compass stalls (no infinite loop)", () => {
    const { protocol, emit } = makeProtocol();
    const { get, setter } = makeState();
    subscribeToCalibrationStatus(makeManager(), protocol, setter, 1, "compass", notify, false);

    emit("magProgress", { compassId: 0, completionPct: 50, calStatus: 2, completionMask: fullMask() });
    emit("magProgress", { compassId: 1, completionPct: 40, calStatus: 2, completionMask: fullMask() });
    emit("magProgress", { compassId: 0, completionPct: 100, calStatus: 3, completionMask: fullMask() });
    emit("magReport", goodReport(0, 4)); // compass 0 done; compass 1 will never report
    // compass 1 keeps streaming a flat 40% — no forward progress, no timer reset
    emit("magProgress", { compassId: 1, completionPct: 40, calStatus: 2, completionMask: fullMask() });

    expect(get().status).toBe("in_progress"); // still waiting on the stuck compass

    vi.advanceTimersByTime(31_000); // past the 30s stall window
    expect(get().status).toBe("waiting_accept"); // good compass 0 offsets available
  });

  it("errors out when nothing ever reports", () => {
    const { protocol, emit } = makeProtocol();
    const { get, setter } = makeState();
    subscribeToCalibrationStatus(makeManager(), protocol, setter, 1, "compass", notify, false);

    emit("magProgress", { compassId: 0, completionPct: 30, calStatus: 2, completionMask: fullMask() });
    vi.advanceTimersByTime(31_000);
    expect(get().status).toBe("error");
  });
});

// ── PX4 ──

describe("PX4 [cal] stall handling", () => {
  function makePx4() {
    const { protocol, emit } = makeProtocol();
    const accel = makeState();
    const activeTypeRef = { current: "accel" as string | null };
    const setters = {
      setAccel: accel.setter,
      setCompass: (() => {}) as React.Dispatch<React.SetStateAction<CalibrationState>>,
      setGyro: (() => {}) as React.Dispatch<React.SetStateAction<CalibrationState>>,
      setLevel: (() => {}) as React.Dispatch<React.SetStateAction<CalibrationState>>,
      setPx4QuickLevel: (() => {}) as React.Dispatch<React.SetStateAction<CalibrationState>>,
      setPx4GnssMagCal: (() => {}) as React.Dispatch<React.SetStateAction<CalibrationState>>,
      setPx4CalActiveType: ((u: React.SetStateAction<string | null>) => {
        activeTypeRef.current = typeof u === "function" ? (u as (p: string | null) => string | null)(activeTypeRef.current) : u;
      }) as React.Dispatch<React.SetStateAction<string | null>>,
    };
    subscribePx4CalStatus(protocol, activeTypeRef, { current: new Set() }, setters, notify, makeManager());
    return { emit, accel };
  }

  it("completes on '[cal] calibration done'", () => {
    const { emit, accel } = makePx4();
    emit("status", { severity: 6, text: "[cal] progress <50>" });
    emit("status", { severity: 6, text: "[cal] calibration done: accel" });
    expect(accel.get().status).toBe("success");
  });

  it("stays alive while progressing, then errors after a real stall", () => {
    const { emit, accel } = makePx4();
    emit("status", { severity: 6, text: "[cal] progress <20>" });
    vi.advanceTimersByTime(59_000);
    emit("status", { severity: 6, text: "[cal] progress <40>" }); // forward progress resets the timer
    vi.advanceTimersByTime(59_000);
    expect(accel.get().status).toBe("in_progress");
    vi.advanceTimersByTime(2_000); // now >60s since the last progress
    expect(accel.get().status).toBe("error");
  });
});

// ── CRC_EXTRA lock (derived from field signature, not read back from the table) ──

describe("MAG_CAL CRC_EXTRA lock", () => {
  const accStr = (s: string, crc: number) => {
    for (let i = 0; i < s.length; i++) crc = crc16Accumulate(s.charCodeAt(i), crc);
    return crc;
  };

  it("derives MAG_CAL_PROGRESS (191) CRC_EXTRA = 92 from the signature", () => {
    // Wire order: fields sorted descending by base-type size (floats before uint8),
    // extensions excluded. completion_mask is uint8_t[10] → +length byte.
    let crc = 0xffff;
    crc = accStr("MAG_CAL_PROGRESS ", crc);
    crc = accStr("float direction_x ", crc);
    crc = accStr("float direction_y ", crc);
    crc = accStr("float direction_z ", crc);
    crc = accStr("uint8_t compass_id ", crc);
    crc = accStr("uint8_t cal_mask ", crc);
    crc = accStr("uint8_t cal_status ", crc);
    crc = accStr("uint8_t attempt ", crc);
    crc = accStr("uint8_t completion_pct ", crc);
    crc = accStr("uint8_t completion_mask ", crc);
    crc = crc16Accumulate(10, crc);
    const extra = (crc ^ (crc >> 8)) & 0xff;
    expect(extra).toBe(92);
    expect(CRC_EXTRA.get(191)).toBe(92);
  });

  it("derives MAG_CAL_REPORT (192) CRC_EXTRA = 36 from the signature", () => {
    // Base fields only (10 floats then 4 uint8); the orientation/scale_factor
    // extensions do not participate in CRC_EXTRA.
    let crc = 0xffff;
    crc = accStr("MAG_CAL_REPORT ", crc);
    crc = accStr("float fitness ", crc);
    crc = accStr("float ofs_x ", crc);
    crc = accStr("float ofs_y ", crc);
    crc = accStr("float ofs_z ", crc);
    crc = accStr("float diag_x ", crc);
    crc = accStr("float diag_y ", crc);
    crc = accStr("float diag_z ", crc);
    crc = accStr("float offdiag_x ", crc);
    crc = accStr("float offdiag_y ", crc);
    crc = accStr("float offdiag_z ", crc);
    crc = accStr("uint8_t compass_id ", crc);
    crc = accStr("uint8_t cal_mask ", crc);
    crc = accStr("uint8_t cal_status ", crc);
    crc = accStr("uint8_t autosaved ", crc);
    const extra = (crc ^ (crc >> 8)) & 0xff;
    expect(extra).toBe(36);
    expect(CRC_EXTRA.get(192)).toBe(36);
  });
});
