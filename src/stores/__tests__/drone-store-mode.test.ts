/**
 * @license GPL-3.0-only
 *
 * The previous flight mode is what tells a paused mission (LOITER entered
 * from AUTO) from any other loiter. Every HEARTBEAT re-reports the current
 * mode, so a repeated report must not overwrite the mode the vehicle came
 * from.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useDroneStore } from "../drone-store";

describe("drone-store flight mode history", () => {
  beforeEach(() => {
    useDroneStore.getState().resetForSelection();
  });

  it("keeps AUTO as the previous mode while LOITER heartbeats repeat", () => {
    const drone = useDroneStore.getState();
    drone.setFlightMode("AUTO");
    drone.setFlightMode("AUTO");
    drone.setFlightMode("LOITER");
    drone.setFlightMode("LOITER");
    drone.setFlightMode("LOITER");

    const s = useDroneStore.getState();
    expect(s.flightMode).toBe("LOITER");
    expect(s.previousMode).toBe("AUTO");
  });

  it("moves the previous mode on a real change", () => {
    const drone = useDroneStore.getState();
    drone.setFlightMode("AUTO");
    drone.setFlightMode("LOITER");
    drone.setFlightMode("RTL");

    expect(useDroneStore.getState().previousMode).toBe("LOITER");
  });
});
