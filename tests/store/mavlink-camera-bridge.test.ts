/**
 * A drone's advertised MAVLink camera (CAMERA_INFORMATION) is kept per drone
 * from its telemetry bridge and dropped when the bridge is torn down.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/telemetry-recorder", () => ({ recordFrameFor: vi.fn() }));

import { bridgeTelemetry } from "@/stores/drone-manager-bridge";
import { useMavlinkCameraStore } from "@/stores/mavlink-camera-store";
import type { CameraInformationCallback, DroneProtocol } from "@/lib/protocol/types";

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

function info(compId: number, capture: boolean, zoom: boolean): Parameters<CameraInformationCallback>[0] {
  return { timestamp: 1, compId, flags: (capture ? 2 : 0) | (zoom ? 64 : 0), cameraDeviceId: 0, capture, zoom };
}

describe("MAVLink camera bridge", () => {
  beforeEach(() => useMavlinkCameraStore.setState({ byDrone: {} }));

  it("keeps each drone's advertised camera and drops it with the bridge", () => {
    const h: Record<string, Handler> = {};
    const unsubscribers = bridgeTelemetry("d1", "Alpha", fakeProtocol(h));
    h.onCameraInformation(info(100, true, false));
    expect(useMavlinkCameraStore.getState().byDrone.d1).toEqual({ capture: true, zoom: false });

    // A component that advertises neither is not a camera the cockpit drives.
    h.onCameraInformation(info(1, false, false));
    expect(useMavlinkCameraStore.getState().byDrone.d1).toEqual({ capture: true, zoom: false });

    for (const off of unsubscribers) off();
    expect(useMavlinkCameraStore.getState().byDrone.d1).toBeUndefined();
  });
});
