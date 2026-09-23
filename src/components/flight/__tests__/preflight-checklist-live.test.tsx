/**
 * @license GPL-3.0-only
 *
 * The pre-flight checklist's readiness gates the Arm and Take-off confirms and
 * is written into the flight record. These tests hold three properties:
 *
 *  - the battery-voltage item judges charge per cell, whatever the pack size;
 *  - auto items follow fresh telemetry with the checklist view closed, and an
 *    item whose telemetry goes stale drops back to pending;
 *  - a session belongs to one drone, so switching drones resets it and a
 *    checklist completed for one aircraft never reads ready for another.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { ChecklistAutoRunner } from "@/components/flight/ChecklistAutoRunner";
import { evaluateAutoChecks, type AutoCheckInputs } from "@/lib/checklist/auto-checks";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import type { BatteryData } from "@/lib/types/telemetry";
import { useChecklistStore } from "@/stores/checklist-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useMissionStore } from "@/stores/mission-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useUploadReceiptsStore } from "@/stores/upload-receipts-store";
import { missionContentHash } from "@/lib/mission-upload";

const NOW = 1_700_000_000_000;

function inputs(battery: BatteryData | undefined, knownCellCount: number | null = null): AutoCheckInputs {
  return {
    battery,
    knownCellCount,
    gps: undefined,
    ekf: undefined,
    sysStatus: undefined,
    missionOnVehicle: null,
    fenceOnVehicle: null,
    formatGpsFix: String,
  };
}

function pack(voltage: number, extra: Partial<BatteryData> = {}): BatteryData {
  return { timestamp: NOW, voltage, remaining: 100, ...extra };
}

const item = (id: string) => useChecklistStore.getState().items.find((i) => i.id === id);

describe("battery checks judge charge per cell", () => {
  it("fails a depleted 6S pack that clears a 3S pack-voltage threshold", () => {
    const v = evaluateAutoChecks(inputs(pack(19.8, { cellCount: 6 })), NOW);
    expect(v["battery-voltage"].status).toBe("fail");
  });

  it("fails on the weakest measured cell", () => {
    const cells = [4.1, 4.1, 4.1, 3.4];
    const v = evaluateAutoChecks(inputs(pack(15.7, { cellVoltages: cells })), NOW);
    expect(v["battery-voltage"].status).toBe("fail");
  });

  it("passes a charged 2S pack below a 3S pack-voltage threshold", () => {
    const v = evaluateAutoChecks(inputs(pack(8.2), 2), NOW);
    expect(v["battery-voltage"].status).toBe("pass");
  });

  it("leaves the voltage item pending when no cell count is known", () => {
    const v = evaluateAutoChecks(inputs(pack(16.0)), NOW);
    expect(v["battery-voltage"].status).toBe("pending");
  });

  it("treats an unestimated remaining capacity as unknown, not empty", () => {
    const v = evaluateAutoChecks(inputs(pack(16.4, { remaining: -1 })), NOW);
    expect(v["battery-level"]).toEqual({ status: "pending", displayValue: "—" });
  });

  it("gives no verdict from a stale battery sample", () => {
    const v = evaluateAutoChecks(inputs(pack(16.8, { cellCount: 4 })), NOW + TELEMETRY_STALE_MS);
    expect(v["battery-level"].status).toBe("pending");
    expect(v["battery-voltage"].status).toBe("pending");
  });
});

describe("sensor and pre-arm items read SYS_STATUS", () => {
  const PREARM = 1 << 28;
  const GYRO = 1 << 0;
  const sys = (healthy: number, timestamp = NOW) => ({
    timestamp, cpuLoad: 100, sensorsPresent: GYRO | PREARM, sensorsEnabled: GYRO | PREARM,
    sensorsHealthy: healthy, batteryRemaining: -1, dropRateComm: 0, errorsComm: 0,
  });

  it("passes on a fresh all-healthy report and fails on an FC pre-arm failure", () => {
    const pass = evaluateAutoChecks({ ...inputs(undefined), sysStatus: sys(GYRO | PREARM) }, NOW);
    expect(pass["sensors-healthy"]).toEqual({ status: "pass", displayValue: "2/2" });
    expect(pass["prearm-pass"].status).toBe("pass");

    const fail = evaluateAutoChecks({ ...inputs(undefined), sysStatus: sys(GYRO) }, NOW);
    expect(fail["prearm-pass"].status).toBe("fail");
  });

  it("gives no verdict from a stale report", () => {
    const v = evaluateAutoChecks({ ...inputs(undefined), sysStatus: sys(GYRO | PREARM) }, NOW + TELEMETRY_STALE_MS);
    expect(v["sensors-healthy"].status).toBe("pending");
    expect(v["prearm-pass"].status).toBe("pending");
  });
});

describe("checklist readiness is live and per drone", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    useTelemetryStore.getState().clear();
    useChecklistStore.getState().resetSession();
    useDroneManager.setState({ selectedDroneId: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useDroneManager.setState({ selectedDroneId: null });
  });

  it("evaluates auto items with the checklist view closed and drops stale ones to pending", () => {
    useDroneManager.setState({ selectedDroneId: "drone-a" });
    useTelemetryStore.getState().pushBattery(pack(16.4, { remaining: 80, cellCount: 4 }));

    renderWithIntl(<ChecklistAutoRunner />);
    expect(useChecklistStore.getState().droneId).toBe("drone-a");
    expect(item("battery-level")?.status).toBe("pass");
    expect(item("battery-voltage")?.status).toBe("pass");

    // The link goes quiet: no new sample arrives, only time passes.
    act(() => {
      vi.advanceTimersByTime(TELEMETRY_STALE_MS + 1_000);
    });
    expect(item("battery-level")?.status).toBe("pending");
    expect(item("battery-voltage")?.status).toBe("pending");
  });

  it("keeps an operator skip on an unknown auto item until a verdict arrives", () => {
    useDroneManager.setState({ selectedDroneId: "drone-a" });
    useTelemetryStore.getState().pushBattery(pack(16.4, { remaining: -1, cellCount: 4 }));
    renderWithIntl(<ChecklistAutoRunner />);

    act(() => useChecklistStore.getState().skipItem("battery-level"));
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(item("battery-level")?.status).toBe("skipped");

    // A measured verdict is not the operator's to skip.
    act(() => useChecklistStore.getState().skipItem("battery-voltage"));
    expect(item("battery-voltage")?.status).toBe("pass");
  });

  it("never reports one drone's completed checklist as another drone's", () => {
    useDroneManager.setState({ selectedDroneId: "drone-a" });
    const store = useChecklistStore.getState();
    store.startSession("drone-a");
    useChecklistStore.setState((s) => ({
      items: s.items.map((i) => ({ ...i, status: "skipped" as const })),
    }));
    expect(useChecklistStore.getState().isReadyToArm("drone-a")).toBe(true);
    expect(useChecklistStore.getState().isReadyToArm("drone-b")).toBe(false);

    useDroneManager.getState().selectDrone("drone-b");

    const after = useChecklistStore.getState();
    expect(after.droneId).toBeNull();
    expect(after.items.every((i) => i.status === "pending")).toBe(true);
    expect(after.isReadyToArm("drone-a")).toBe(false);
    expect(after.isReadyToArm("drone-b")).toBe(false);
  });

  it("passes the plan and fence items only on what the vehicle acknowledged", () => {
    useDroneManager.setState({ selectedDroneId: "drone-a" });
    useUploadReceiptsStore.setState({ receipts: {} });
    const waypoints = [
      { id: "w1", lat: 12.9, lon: 77.6, alt: 30 },
      { id: "w2", lat: 12.91, lon: 77.61, alt: 30 },
    ];
    // Planned and drawn locally, never uploaded.
    useMissionStore.setState({ waypoints });
    useGeofenceStore.setState({ enabled: true });
    renderWithIntl(<ChecklistAutoRunner />);
    expect(item("flight-plan")).toMatchObject({ status: "pending", displayValue: "Not on vehicle" });
    expect(item("geofence-set")).toMatchObject({ status: "pending", displayValue: "Not on vehicle" });

    // The vehicle acknowledged exactly this plan.
    act(() => {
      useUploadReceiptsStore.getState().record("mission", {
        droneId: "drone-a",
        contentHash: missionContentHash(waypoints),
        at: NOW,
      });
    });
    expect(item("flight-plan")).toMatchObject({ status: "pass", displayValue: "2 wpts" });

    // An edit after the upload is not on the vehicle.
    act(() => {
      useMissionStore.setState({ waypoints: [waypoints[0]] });
    });
    expect(item("flight-plan")?.status).toBe("pending");
  });
});
