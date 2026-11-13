/**
 * @module mock/mock-flight-state.test
 * @description Demo arm / disarm / land / takeoff follow the real FC path.
 *
 * A disarm in flight is refused the way ArduPilot refuses a GCS disarm with no
 * force flag; Land puts the demo drone down, after which it disarms. Each
 * change heartbeats at once, so the drone's registry arm state follows it.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Arming starts the flight log's weather and place lookups; keep them off the
// network so no request outlives the test file.
vi.mock("@/lib/environment/weather-provider", () => ({ getWeatherSnapshot: async () => undefined }));
vi.mock("@/lib/geocoding/reverse", () => ({ reverseGeocode: async () => undefined }));

import { MockProtocol } from "@/mock/mock-protocol";
import { mockEngine } from "@/mock/engine";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore, resolveNodeId } from "@/stores/node-registry";

function flyingProtocol() {
  const p = new MockProtocol("ardupilot-copter");
  p.flight.init({ armed: true, airborne: true, mode: "AUTO" });
  const beats: Array<{ armed: boolean; mode: string }> = [];
  p.onHeartbeat((hb) => beats.push({ armed: hb.armed, mode: hb.mode }));
  return { p, beats };
}

describe("MockProtocol flight state", () => {
  it("refuses a disarm while airborne, like a real FC", async () => {
    const { p, beats } = flyingProtocol();
    const result = await p.disarm();
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(4);
    expect(p.flight.armed).toBe(true);
    expect(beats).toHaveLength(0);
  });

  it("lands, then disarms, heartbeating each change", async () => {
    const { p, beats } = flyingProtocol();
    expect((await p.land()).success).toBe(true);
    expect(p.flight.airborne).toBe(false);
    expect(beats.at(-1)).toEqual({ armed: true, mode: "LAND" });

    expect((await p.disarm()).success).toBe(true);
    expect(p.flight.armed).toBe(false);
    expect(beats.at(-1)).toEqual({ armed: false, mode: "LAND" });
  });

  it("arms on the ground without taking off, and refuses takeoff while disarmed", async () => {
    const p = new MockProtocol("ardupilot-copter");
    expect((await p.takeoff(10)).success).toBe(false);
    expect(p.flight.airborne).toBe(false);

    expect((await p.arm()).success).toBe(true);
    expect(p.flight).toMatchObject({ armed: true, airborne: false });
    expect((await p.takeoff(10)).success).toBe(true);
    expect(p.flight).toMatchObject({ armed: true, airborne: true, mode: "GUIDED" });
  });

  it("carries a mode change into the heartbeat", async () => {
    const { p, beats } = flyingProtocol();
    await p.setFlightMode("LOITER");
    expect(p.flight.mode).toBe("LOITER");
    expect(beats.at(-1)).toEqual({ armed: true, mode: "LOITER" });
  });
});

describe("demo engine · land and disarm", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    mockEngine.stop();
    vi.useRealTimers();
  });

  it("a landed, disarmed demo drone reports disarmed in the registry and stays on the ground", async () => {
    mockEngine.start(50);
    const id = resolveNodeId("alpha-1");
    const protocol = useDroneManager.getState().drones.get(id)?.protocol;
    expect(protocol).toBeInstanceOf(MockProtocol);
    const p = protocol as MockProtocol;

    expect((await p.disarm()).success).toBe(false);
    await p.land();
    expect((await p.disarm()).success).toBe(true);
    expect(useNodeRegistryStore.getState().getEntry(id)?.fc.armState).toBe("disarmed");

    vi.advanceTimersByTime(500);
    const fc = useNodeRegistryStore.getState().getEntry(id)?.fc;
    expect(fc?.armState).toBe("disarmed");
    expect(fc?.position?.relativeAlt).toBe(0);
    expect(fc?.position?.groundSpeed).toBe(0);
  });
});
