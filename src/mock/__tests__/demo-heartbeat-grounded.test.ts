/**
 * The demo FC heartbeat carries the firmware's custom mode (so mission-state
 * readers see AUTO), and a landed demo drone keeps reporting its pack, fix and
 * height above terrain.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MockProtocol } from "@/mock/mock-protocol";
import { tickGroundedDrone } from "@/mock/engine-grounded";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { inAuto } from "@/lib/mission/mission-state";
import { resolveNavSource } from "@/lib/hud/nav-source";
import { preflightItems } from "@/lib/cockpit/preflight";

describe("demo heartbeat and grounded tick", () => {
  beforeEach(() => {
    useNodeRegistryStore.getState().clear();
    useTelemetryStore.getState().clear?.();
  });

  it("puts the ArduCopter AUTO custom mode on the heartbeat", () => {
    const p = new MockProtocol("ardupilot-copter");
    const seen: Array<number | undefined> = [];
    p.onHeartbeat((hb) => seen.push(hb.customMode));
    p.emitHeartbeat(true, "AUTO");
    expect(seen).toHaveLength(1);
    expect(inAuto("ardupilot-copter", seen[0]!)).toBe(true);
  });

  it("keeps battery, GPS, SYS_STATUS and terrain flowing after a landing", () => {
    const now = Date.now();
    const reg = useNodeRegistryStore.getState();
    reg.upsertPresence("n1", { name: "N1", profile: "drone", lastHeartbeat: now }, "local");
    reg.updateFcTelemetry("n1", {
      position: { timestamp: now, lat: 1, lon: 2, alt: 60, relativeAlt: 10, heading: 0, groundSpeed: 0, airSpeed: 0, climbRate: 0 },
      battery: { timestamp: now, voltage: 16.2, current: 9, remaining: 72 },
      gps: { timestamp: now, fixType: 3, satellites: 14, hdop: 0.8, lat: 1, lon: 2, alt: 60 },
    } as never);
    const p = new MockProtocol("ardupilot-copter");
    const sys: number[] = [];
    const agl: number[] = [];
    p.onSysStatus((s) => sys.push(s.batteryRemaining));
    p.onTerrain((t) => agl.push(t.currentHeight - t.terrainHeight));
    tickGroundedDrone("n1", p, 5, true, now + 1000);
    const tel = useTelemetryStore.getState();
    expect(tel.battery.latest()?.remaining).toBe(72);
    expect(tel.gps.latest()?.satellites).toBe(14);
    expect(sys).toEqual([72]);
    expect(agl).toEqual([0]);
  });

  it("keeps the navigation source reported on the ground, so the pre-flight item passes", () => {
    const now = Date.now();
    const reg = useNodeRegistryStore.getState();
    reg.upsertPresence("n1", { name: "N1", profile: "drone", lastHeartbeat: now }, "local");
    const p = new MockProtocol("ardupilot-copter");
    const flags: number[] = [];
    p.onEkf((e) => flags.push(e.flags));
    for (let tick = 1; tick <= 10; tick++) tickGroundedDrone("n1", p, tick, true, now + tick * 200);
    expect(flags).toHaveLength(2);
    const nav = resolveNavSource({
      ekf: { flags: flags[1], ageMs: 0 },
      gps: { fixType: 3, satellites: 14, hdop: 0.8 },
      nav: null,
      lastCommandedSet: null,
      params: null,
    });
    expect(nav.kind).not.toBe("stale");
    const items = preflightItems({
      readiness: [], prearm: [], checks: [], live: true, nav, controlMode: null,
      controller: { connected: false, name: null }, onScreenSticks: false, storagePct: 40,
    });
    expect(items.find((i) => i.id === "nav_source")?.state).toBe("pass");
  });
});
