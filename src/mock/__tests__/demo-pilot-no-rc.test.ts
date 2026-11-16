/**
 * @module mock/demo-pilot-no-rc.test
 * @description The demo pilot's no-RC declaration mirrors the real pilot:
 * `rc_receiver:absent` is taken on the ground in `ados` control in an open
 * place, refused while armed, outside `ados` or in a confined place; with it
 * a confined place or leaving `ados` is refused `rc_receiver_absent`, the
 * state reads `rc_receiver: "absent"` and the readiness gains the posture and
 * link-loss rows.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Arming starts the flight log's weather and place lookups; keep them off the
// network so no request outlives the test file.
vi.mock("@/lib/environment/weather-provider", () => ({ getWeatherSnapshot: async () => undefined }));
vi.mock("@/lib/geocoding/reverse", () => ({ reverseGeocode: async () => undefined }));

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { requestPilotAction } from "@/lib/input/pilot-stream";
import { mockEngine } from "@/mock/engine";
import { mockPilot } from "@/mock/mock-pilot";
import { MockProtocol } from "@/mock/mock-protocol";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { resolveNodeId } from "@/stores/node-registry";
import { useSettingsStore } from "@/stores/settings-store";

const ID = resolveNodeId("alpha-1");

function vehicle(): MockProtocol {
  const protocol = useDroneManager.getState().drones.get(ID)?.protocol;
  expect(protocol).toBeInstanceOf(MockProtocol);
  return protocol as MockProtocol;
}

function pilot(): PilotState {
  const feed = useNavStreamStore.getState().byDrone[ID]?.pilot;
  expect(feed).toBeDefined();
  return feed!.data;
}

beforeEach(() => {
  vi.useFakeTimers();
  void useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
  mockEngine.start(50);
  vehicle().flight.init({ armed: false, airborne: false, mode: "GUIDED" });
  mockPilot.start(ID);
  vi.advanceTimersByTime(200);
});

afterEach(() => {
  mockPilot.stop();
  mockEngine.stop();
  useNavStreamStore.getState().clear(ID);
  void useSettingsStore.setState({ demoMode: false });
  vi.useRealTimers();
});

describe("demo no-RC declaration", () => {
  it("is declared on the ground and shows in the state and readiness", async () => {
    expect(pilot().rcReceiver).toBe("present");
    await expect(requestPilotAction("rc_receiver:absent")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().rcReceiver).toBe("absent");
    const rows = pilot().readiness.filter((r) => r.id === "rc_receiver" || r.id === "link_loss_posture");
    expect(rows.map((r) => [r.id, r.ok, r.severity])).toEqual([
      ["rc_receiver", true, "warn"],
      ["link_loss_posture", true, "warn"],
    ]);
    await expect(requestPilotAction("rc_receiver:present")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().rcReceiver).toBe("present");
    expect(pilot().readiness.some((r) => r.id === "rc_receiver")).toBe(false);
  });

  it("refuses a confined place and leaving ados while declared", async () => {
    await requestPilotAction("rc_receiver:absent");
    await expect(requestPilotAction("place_class:confined")).resolves.toEqual({ ok: false, err: "rc_receiver_absent" });
    await expect(requestPilotAction("control_mode:fc_manual")).resolves.toEqual({ ok: false, err: "rc_receiver_absent" });
    await expect(requestPilotAction("control_mode:ados")).resolves.toEqual({ ok: true });
  });

  it("refuses the declaration outside ados and in a confined place", async () => {
    await requestPilotAction("control_mode:fc_manual");
    await expect(requestPilotAction("rc_receiver:absent")).resolves.toEqual({ ok: false, err: "control_mode" });
    await requestPilotAction("control_mode:ados");
    await requestPilotAction("place_class:confined");
    await expect(requestPilotAction("rc_receiver:absent")).resolves.toEqual({ ok: false, err: "confined" });
  });

  it("refuses the declaration while armed", async () => {
    vehicle().flight.init({ armed: true, airborne: false, mode: "GUIDED" });
    vi.advanceTimersByTime(200);
    await expect(requestPilotAction("rc_receiver:absent")).resolves.toEqual({ ok: false, err: "armed" });
  });
});
