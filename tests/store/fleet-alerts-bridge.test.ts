/**
 * Fleet alerts (Dashboard alert counts and feed) come from each connected
 * drone's own frames: critical STATUSTEXT and failsafe announcements, the
 * battery entering the operator's warning or critical band, and the FC link
 * going silent. Each condition raises once when it starts.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

vi.mock("@/lib/telemetry-recorder", () => ({ recordFrameFor: vi.fn() }));

import { bridgeTelemetry } from "@/stores/drone-manager-bridge";
import { useFleetStore } from "@/stores/fleet-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { DroneProtocol } from "@/lib/protocol/types";

type Handler = (data?: unknown) => void;

function fakeProtocol(handlers: Record<string, Handler>): DroneProtocol {
  return new Proxy({} as DroneProtocol, {
    get: (_t, key) => {
      if (typeof key === "string" && key.startsWith("on")) {
        return (cb: Handler) => {
          handlers[key] = cb;
          return () => {};
        };
      }
      return undefined;
    },
  });
}

function sysStatus(batteryRemaining: number) {
  return {
    timestamp: Date.now(),
    batteryRemaining,
    voltageBattery: 15,
    currentBattery: 10,
    onboardControlSensorsPresent: 0,
    onboardControlSensorsEnabled: 0,
    onboardControlSensorsHealth: 0,
    load: 0,
    dropRateComm: 0,
  };
}

describe("fleet alerts from live telemetry", () => {
  let h: Record<string, Handler>;

  beforeEach(() => {
    useFleetStore.getState().clearAlerts();
    useSettingsStore.setState({ batteryWarningPct: 30, batteryCriticalPct: 15 });
    h = {};
    bridgeTelemetry("d1", "Alpha", fakeProtocol(h));
  });

  const alerts = () => useFleetStore.getState().alerts;

  it("raises a critical alert for a CRITICAL-or-worse STATUSTEXT", () => {
    h.onStatusText({ severity: 2, text: "PreArm: Compass not calibrated", timestamp: 1 });
    h.onStatusText({ severity: 6, text: "Mission: 3 WP", timestamp: 2 });
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({
      droneId: "d1",
      droneName: "Alpha",
      severity: "critical",
      message: "PreArm: Compass not calibrated",
      acknowledged: false,
    });
  });

  it("raises once per battery band entered, never for an unreported pack", () => {
    h.onSysStatus(sysStatus(-1));
    h.onSysStatus(sysStatus(80));
    h.onSysStatus(sysStatus(28));
    h.onSysStatus(sysStatus(27));
    h.onSysStatus(sysStatus(12));
    h.onSysStatus(sysStatus(11));
    expect(alerts().map((a) => a.severity)).toEqual(["critical", "warning"]);
  });

  it("raises once when the FC link goes silent, again only after it came back", () => {
    h.onLinkLost();
    h.onLinkLost();
    expect(alerts()).toHaveLength(1);
    h.onLinkRestored();
    h.onLinkLost();
    expect(alerts()).toHaveLength(2);
    expect(alerts()[0].severity).toBe("critical");
  });
});
