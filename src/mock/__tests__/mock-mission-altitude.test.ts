/**
 * A demo ArduPilot vehicle keeps an uploaded altitude in whole centimetres,
 * as the firmware does, so its read-back verifies the way a real one does.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homeItem } from "@/lib/mission/mission-item-encode";
import { missionReadBackMatches } from "@/lib/mission/mission-verify";
import type { MissionItem } from "@/lib/protocol/types";
import { MockMission } from "../mock-protocol-mission";

const waypoint: MissionItem = {
  seq: 1, frame: 3, command: 16, current: 0, autocontinue: 1,
  param1: 0, param2: 0, param3: 0, param4: 0, x: 471000000, y: 81000000, z: 35.67,
};

async function roundTrip(mission: MockMission, items: MissionItem[]): Promise<MissionItem[]> {
  await mission.upload(items);
  const down = mission.download();
  await vi.runAllTimersAsync();
  return down;
}

describe("demo mission altitude", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("verifies a 35.67 m upload on ArduPilot from the stored centimetres", async () => {
    const sent = [homeItem({ lat: 47.1, lon: 8.1, alt: 410 }), waypoint];
    const echo = await roundTrip(new MockMission(() => true), sent);
    expect(echo[1].z).toBe(Math.fround(3566 * Math.fround(0.01)));
    expect(missionReadBackMatches(sent, echo, "ardupilot-copter")).toBe(true);
  });

  it("keeps a non-ArduPilot altitude as sent", async () => {
    const echo = await roundTrip(new MockMission(() => false), [waypoint]);
    expect(echo[0].z).toBe(35.67);
  });
});
