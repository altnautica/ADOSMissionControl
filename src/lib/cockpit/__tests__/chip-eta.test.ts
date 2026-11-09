/**
 * The flight-state chip fills `{eta}` from the next waypoint gate of the
 * drone's `ar` frame: "MISSION · WP n/N · m:ss".
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import arFixture from "../layers/fixtures/ar-frame.json";
import pilotFixture from "../layers/fixtures/pilot-frame.json";
import { parseArFrame, parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { evaluateChip, formatEta, nextWaypointEtaS } from "../flight-state";
import type { MissionStatus } from "@/lib/mission/mission-state";

const pilot = { ...parsePilotState(pilotFixture)!, owner: "mission_fc" } as PilotState;
const mission: MissionStatus = {
  state: "active",
  seq: 3,
  total: 6,
  itemReached: null,
  id: 0,
  source: "mission_state",
  ageMs: 0,
  landingSeq: false,
};

function chip(etaS: number | null) {
  return evaluateChip({ pilot, pilotAgeMs: 0, mission, completeSinceMs: null, etaS, now: 1000 });
}

describe("chip ETA", () => {
  it("reads the next gate's ETA from the ar frame", () => {
    expect(nextWaypointEtaS(parseArFrame(arFixture))).toBe(42);
    expect(nextWaypointEtaS(null)).toBeNull();
  });

  it("formats m:ss", () => {
    expect(formatEta(42)).toBe("0:42");
    expect(formatEta(125.4)).toBe("2:05");
    expect(formatEta(null)).toBe("");
  });

  it("shows the ETA on the active mission chip, and drops it when unknown", () => {
    expect(chip(42).text).toBe("MISSION · WP 3/6 · 0:42");
    expect(chip(null).text).toBe("MISSION · WP 3/6");
  });
});
