/**
 * @license GPL-3.0-only
 *
 * Switching the selected drone leaves nothing measured for the newly selected
 * one: its arm state and mode read unknown, so the safety band cannot show a
 * DISARMED or a mode that no heartbeat reported, even if the previous drone's
 * heartbeat was still fresh.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useDroneManager } from "../drone-manager";
import { useDroneStore } from "../drone-store";
import { deriveHudStatus } from "@/lib/hud-readings";

describe("drone selection resets the flight state to unmeasured", () => {
  beforeEach(() => {
    useDroneManager.setState({ selectedDroneId: null });
  });

  it("the newly selected drone reads unknown arm state and mode", () => {
    useDroneManager.setState({ selectedDroneId: "A" });
    const drone = useDroneStore.getState();
    drone.setConnectionState("connected");
    drone.setArmState("armed");
    drone.setFlightMode("LOITER");
    drone.heartbeat();

    useDroneManager.getState().selectDrone("B");

    const after = useDroneStore.getState();
    expect(after.armState).toBe("unknown");
    expect(after.armedAt).toBeNull();
    expect(after.flightMode).toBe("UNKNOWN");
    expect(after.lastHeartbeat).toBe(0);

    const hud = deriveHudStatus({}, after);
    expect(hud.armed).toBeNull();
  });

});
