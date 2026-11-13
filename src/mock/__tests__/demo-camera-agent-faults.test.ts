/**
 * @module mock/demo-camera-agent-faults.test
 * @description Demo mode reaches the vehicle-camera and agent-unreachable
 * states: a demo vehicle advertises a MAVLink camera (CAMERA_INFORMATION with
 * still capture and zoom) and accepts its capture and zoom commands, so the
 * cockpit's photo and zoom take the vehicle-camera route; and
 * `failDemoAgentPolls(n)` fails the next n agent status polls, so the agent
 * reads unreachable and then recovers.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mavlinkCameraFor } from "@/lib/cockpit/camera-actions";
import { failDemoAgentPolls } from "@/mock/demo-link";
import { mockEngine } from "@/mock/engine";
import { MockProtocol } from "@/mock/mock-protocol";
import { POLL_BASE_MS } from "@/stores/agent-connection/poll-backoff";
import { useAgentConnectionStore } from "@/stores/agent-connection";
import { useDroneManager } from "@/stores/drone-manager";
import { useMavlinkCameraStore } from "@/stores/mavlink-camera-store";
import { resolveNodeId } from "@/stores/node-registry";

const ID = resolveNodeId("alpha-1");

describe("demo vehicle camera", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockEngine.start(50);
  });
  afterEach(() => {
    mockEngine.stop();
    vi.useRealTimers();
  });

  it("advertises still capture and zoom, and accepts both commands", async () => {
    const protocol = useDroneManager.getState().drones.get(ID)?.protocol;
    expect(protocol).toBeInstanceOf(MockProtocol);
    const advertised = useMavlinkCameraStore.getState().byDrone[ID];
    expect(advertised).toEqual({ capture: true, zoom: true });

    const camera = mavlinkCameraFor(advertised, protocol);
    expect(camera).not.toBeNull();
    expect(camera!.zoom).toBe(true);
    await expect(camera!.capture()).resolves.toMatchObject({ ok: true, answered: true });
    await expect(camera!.zoomStep(1)).resolves.toMatchObject({ ok: true, answered: true });
    await expect(camera!.zoomStep(-1)).resolves.toMatchObject({ ok: true, answered: true });
  });

  it("acks MAV_CMD_IMAGE_START_CAPTURE and continuous MAV_CMD_SET_CAMERA_ZOOM, and denies ZOOM_TYPE_STEP as ArduPilot does", async () => {
    const protocol = useDroneManager.getState().drones.get(ID)!.protocol as MockProtocol;
    await expect(protocol.sendCommand(2000, [0, 0, 1, 0, 0, 0, 0])).resolves.toMatchObject({ success: true, resultCode: 0 });
    await expect(protocol.sendCommand(531, [1, 1, 0, 0, 0, 0, 0])).resolves.toMatchObject({ success: true, resultCode: 0 });
    await expect(protocol.sendCommand(531, [1, 0, 0, 0, 0, 0, 0])).resolves.toMatchObject({ success: true, resultCode: 0 });
    await expect(protocol.sendCommand(531, [0, 1, 0, 0, 0, 0, 0])).resolves.toMatchObject({ success: false, resultCode: 2 });
  });
});

describe("demo agent poll faults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    failDemoAgentPolls(0);
    useAgentConnectionStore.getState().disconnect();
    vi.useRealTimers();
  });

  it("fails the next n status polls, then the agent answers again", async () => {
    const connecting = useAgentConnectionStore.getState().connect("mock://demo");
    // The demo client loads lazily; its replies then ride the fake clock.
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(1000);
    await connecting;
    expect(useAgentConnectionStore.getState().consecutiveFailures).toBe(0);

    failDemoAgentPolls(1);
    await vi.advanceTimersByTimeAsync(POLL_BASE_MS);
    // The pill reads the agent unreachable from three failures on.
    expect(useAgentConnectionStore.getState().consecutiveFailures).toBeGreaterThanOrEqual(3);

    await vi.advanceTimersByTimeAsync(POLL_BASE_MS);
    expect(useAgentConnectionStore.getState().consecutiveFailures).toBe(0);
  });
});
