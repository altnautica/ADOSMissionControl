/**
 * A plugin's mission.write against the real mission validator and the
 * operator's own geofence: the plugin may not upload a mission the planner's
 * upload gate would refuse, may not smuggle in commands the planner does not
 * produce, and may not upload after the vehicle armed while the operator was
 * deciding.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
});

const vehicle = vi.hoisted(() => ({ armState: "disarmed" as "armed" | "disarmed" }));
const protocol = vi.hoisted(() => ({ sendCommand: async () => ({ success: true }) }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => ({ drones: new Map([["node:d1", { protocol, name: "Drone 1" }]]) }),
  },
}));
vi.mock("@/stores/node-registry", () => ({
  useNodeRegistryStore: {
    getState: () => ({
      getEntry: (id: string) =>
        id === "node:d1"
          ? { fc: { armState: vehicle.armState, managedId: "fc-1" }, connection: { fcConnected: true } }
          : undefined,
    }),
  },
}));
const mission = vi.hoisted(() => ({ setWaypoints: vi.fn(), uploadMission: vi.fn(async () => true) }));
vi.mock("@/stores/mission-store", () => ({ useMissionStore: { getState: () => mission } }));

import { buildMissionWriteHandler } from "@/lib/plugins/handlers/mission-write";
import { setPluginConfirmHandler } from "@/lib/plugins/confirm";
import { useGeofenceStore } from "@/stores/geofence-store";
import type { BridgeHandlerContext } from "@/lib/plugins/bridge";

const TARGET = { nodeId: "node:d1", deviceId: "d1" };
const CTX = {} as BridgeHandlerContext;
const initialGeofence = useGeofenceStore.getState();

function write(waypoints: unknown[]) {
  return buildMissionWriteHandler("com.example.survey", TARGET)({ payload: { waypoints } }, CTX);
}

beforeEach(() => {
  vehicle.armState = "disarmed";
  mission.setWaypoints.mockClear();
  mission.uploadMission.mockClear();
  setPluginConfirmHandler(async () => true);
});

afterEach(() => {
  setPluginConfirmHandler(null);
  useGeofenceStore.setState(initialGeofence, true);
});

describe("plugin mission.write", () => {
  it("refuses a mission that breaks the operator's geofence ceiling", async () => {
    useGeofenceStore.setState({ enabled: true, maxAltitude: 50 });
    const out = await write([
      { id: "w1", lat: 12.9, lon: 77.6, alt: 30, command: "TAKEOFF" },
      { id: "w2", lat: 12.901, lon: 77.601, alt: 120 },
    ]);
    expect(out).toMatchObject({ ok: false, error: "invalid mission" });
    const codes = ((out as { errors?: Array<{ code: string }> }).errors ?? []).map((e) => e.code);
    expect(codes).toContain("ALTITUDE_EXCEEDED");
    expect(mission.uploadMission).not.toHaveBeenCalled();
  });

  it("refuses a command the planner never produces", async () => {
    const out = await write([
      { id: "w1", lat: 12.9, lon: 77.6, alt: 30, command: "PREFLIGHT_REBOOT_SHUTDOWN" },
    ]);
    expect(out).toMatchObject({ ok: false });
    expect(String((out as { error?: unknown }).error)).toMatch(/not permitted/);
    expect(mission.uploadMission).not.toHaveBeenCalled();
  });

  it("does not upload when the vehicle armed while the operator was deciding", async () => {
    setPluginConfirmHandler(async () => {
      vehicle.armState = "armed";
      return true;
    });
    const out = await write([
      { id: "w1", lat: 12.9, lon: 77.6, alt: 30, command: "TAKEOFF" },
      { id: "w2", lat: 12.901, lon: 77.601, alt: 30 },
    ]);
    expect(out).toMatchObject({ ok: false, error: "cannot write mission while armed" });
    expect(mission.uploadMission).not.toHaveBeenCalled();
  });

  it("uploads a mission inside the fence once approved", async () => {
    useGeofenceStore.setState({ enabled: true, maxAltitude: 50 });
    const out = await write([
      { id: "w1", lat: 12.9, lon: 77.6, alt: 30, command: "TAKEOFF" },
      { id: "w2", lat: 12.901, lon: 77.601, alt: 40 },
    ]);
    expect(out).toEqual({ ok: true });
    expect(mission.uploadMission).toHaveBeenCalledWith(protocol);
  });
});
