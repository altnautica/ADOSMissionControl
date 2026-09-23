/**
 * The operator's disconnect is never mistaken for a dropped link, and a
 * "commit then disconnect" keeps the link up until the commit is answered.
 *
 * The transport here closes synchronously inside `protocol.disconnect()`, the
 * way the WebSocket transport does, which is the timing that used to let the
 * close handler see no intentional mark and start an auto-reconnect.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/stores/drone-manager-bridge", () => ({ bridgeTelemetry: vi.fn(() => []) }));
vi.mock("@/stores/telemetry-store", () => ({
  useTelemetryStore: { getState: () => ({ clear: vi.fn() }), setState: vi.fn() },
}));
vi.mock("@/stores/drone-store", () => ({
  useDroneStore: {
    getState: () => ({
      selectDrone: vi.fn(),
      setConnectionState: vi.fn(),
      setFlightMode: vi.fn(),
      setArmState: vi.fn(),
      setSystemStatus: vi.fn(),
      setFirmwareType: vi.fn(),
    }),
    setState: vi.fn(),
  },
}));
vi.mock("@/stores/fleet-store", () => ({
  useFleetStore: { getState: () => ({ addDrone: vi.fn(), removeDrone: vi.fn() }), setState: vi.fn() },
}));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: { getState: () => ({ autoRecordOnConnect: false }), setState: vi.fn() },
}));
vi.mock("@/stores/diagnostics-store", () => ({
  useDiagnosticsStore: { getState: () => ({ logConnection: vi.fn() }), setState: vi.fn() },
}));
vi.mock("@/lib/telemetry-recorder", () => ({
  startRecording: vi.fn(),
  getRecordingState: vi.fn(() => ({ state: "idle" })),
  isRecordingFor: vi.fn(() => false),
  stopRecordingFor: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/components/fc/parameters/ParametersPanel", () => ({ invalidateParamCache: vi.fn() }));

import { onUnexpectedDisconnect, useDroneManager } from "@/stores/drone-manager";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { useDisconnectGuard } from "@/hooks/use-disconnect-guard";
import type { DroneProtocol, Transport, VehicleInfo } from "@/lib/protocol/types";

/** A drone whose transport emits `close` synchronously when disconnected. */
function addWebSocketDrone(id: string, commit?: () => Promise<unknown>) {
  const listeners = new Map<string, Set<() => void>>();
  const transport = {
    on: (event: string, h: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(h);
    },
    off: (event: string, h: () => void) => listeners.get(event)?.delete(h),
    write: vi.fn(),
    close: vi.fn(),
  } as unknown as Transport;
  const events: string[] = [];
  const protocol = {
    isConnected: true,
    disconnect: vi.fn(async () => {
      events.push("disconnect");
      for (const h of listeners.get("close") ?? []) h();
    }),
    commitParamsToFlash: vi.fn(async () => {
      events.push("commit-sent");
      await commit?.();
      events.push("commit-answered");
      return { success: true };
    }),
    getAllParameters: vi.fn().mockResolvedValue([]),
  } as unknown as DroneProtocol;
  const info = { systemId: 1, componentId: 1, autopilot: 3, vehicleType: 2, firmwareType: "ardupilot" } as unknown as VehicleInfo;
  useDroneManager.getState().addDrone(id, "Drone 1", protocol, transport, info);
  return { events };
}

afterEach(() => {
  for (const id of [...useDroneManager.getState().drones.keys()]) {
    useDroneManager.getState().disconnectDrone(id);
  }
});

describe("operator disconnect", () => {
  it("is never treated as a dropped link", () => {
    addWebSocketDrone("ws-1");
    const dropped = vi.fn();
    const off = onUnexpectedDisconnect(dropped);
    const { result } = renderHook(() => useDisconnectGuard());

    act(() => result.current.requestDisconnect("ws-1"));

    expect(dropped).not.toHaveBeenCalled();
    expect(useDroneManager.getState().drones.has("ws-1")).toBe(false);
    off();
  });

  it("keeps the link up until the flash commit is answered", async () => {
    const reply = Promise.withResolvers<void>();
    const { events } = addWebSocketDrone("ws-2", () => reply.promise);
    vi.spyOn(useParamSafetyStore.getState(), "getPendingCount").mockReturnValue(1);
    const { result } = renderHook(() => useDisconnectGuard());

    act(() => result.current.requestDisconnect("ws-2"));
    let done!: Promise<void>;
    act(() => {
      done = result.current.commitAndDisconnect() as Promise<void>;
    });
    expect(events).toEqual(["commit-sent"]);

    reply.resolve();
    await act(async () => {
      await done;
    });
    expect(events).toEqual(["commit-sent", "commit-answered", "disconnect"]);
  });
});
