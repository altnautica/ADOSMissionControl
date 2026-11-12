/**
 * @license GPL-3.0-only
 *
 * The upload read-back check against the copy an ArduPilot vehicle returns:
 * it rebuilds each item from what the command stores, so unset headings, the
 * frame of a location-less item and unused slots come back as zero.
 */

import { describe, expect, it } from "vitest";

import type { MissionItem } from "@/lib/protocol/types";
import type { Waypoint } from "@/lib/types";
import { actionItem, homeItem, navItem } from "../mission-item-encode";
import { missionReadBackMatches } from "../mission-verify";

const takeoff: Waypoint = { id: "t", lat: 47.1, lon: 8.1, alt: 20, command: "TAKEOFF" };
const leg: Waypoint = { id: "w", lat: 47.101, lon: 8.102, alt: 35, holdTime: 3 };
const rtl: Waypoint = { id: "r", lat: 47.101, lon: 8.102, alt: 35, command: "RTL" };

/** What the planner sends: home, takeoff, a waypoint with a speed change, RTL. */
function sentMission(): MissionItem[] {
  return [
    homeItem({ lat: 47.1, lon: 8.1, alt: 410 }),
    navItem(takeoff, 1, true, "relative"),
    navItem(leg, 2, false, "relative"),
    actionItem({ id: "s", command: "DO_SET_SPEED", param1: 1, param2: 8, param3: -1 }, 3, 3, new Map(), "ardupilot"),
    navItem(rtl, 4, false, "relative"),
  ];
}

/**
 * The items an ArduPilot Copter returns for `sentMission()`: a zeroed packet
 * with only what each command stores (`AP_Mission::mission_cmd_to_mavlink_int`).
 */
function copterEcho(sent: MissionItem[]): MissionItem[] {
  const zero = { current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 0, y: 0, z: 0 };
  return [
    { ...sent[0], z: 409.5 },
    { ...zero, seq: 1, command: 22, frame: 3, x: sent[1].x, y: sent[1].y, z: 20 },
    { ...zero, seq: 2, command: 16, frame: 3, param1: 3, x: sent[2].x, y: sent[2].y, z: 35 },
    { ...zero, seq: 3, command: 178, frame: 0, param1: 1, param2: 8, param3: -1 },
    { ...zero, seq: 4, command: 20, frame: 0 },
  ];
}

describe("missionReadBackMatches on ArduPilot", () => {
  it("accepts the copy a Copter returns for a normal upload", () => {
    const sent = sentMission();
    // The planner sends an unset heading as NaN and RTL / actions in MAV_FRAME_MISSION.
    expect(Number.isNaN(sent[1].param4)).toBe(true);
    expect(sent[4].frame).toBe(2);
    expect(missionReadBackMatches(sent, copterEcho(sent), "ardupilot-copter")).toBe(true);
  });

  it("still reports a waypoint the vehicle holds elsewhere", () => {
    const sent = sentMission();
    const echo = copterEcho(sent);
    echo[2] = { ...echo[2], x: echo[2].x + 50 };
    expect(missionReadBackMatches(sent, echo, "ardupilot-copter")).toBe(false);
  });

  it("still reports a changed stored parameter or altitude", () => {
    const sent = sentMission();
    const delay = copterEcho(sent);
    delay[2] = { ...delay[2], param1: 0 };
    expect(missionReadBackMatches(sent, delay, "ardupilot-copter")).toBe(false);

    const speed = copterEcho(sent);
    speed[3] = { ...speed[3], param2: 5 };
    expect(missionReadBackMatches(sent, speed, "ardupilot-copter")).toBe(false);

    const alt = copterEcho(sent);
    alt[1] = { ...alt[1], z: 25 };
    expect(missionReadBackMatches(sent, alt, "ardupilot-copter")).toBe(false);

    const frame = copterEcho(sent);
    frame[2] = { ...frame[2], frame: 0 };
    expect(missionReadBackMatches(sent, frame, "ardupilot-copter")).toBe(false);
  });

  it("reads an altitude by the whole centimetres the vehicle keeps", () => {
    const sent = sentMission();
    sent[2] = { ...sent[2], z: 35.67 };
    // 35.67 m as float32 times 100 is 3566.9998 cm, stored as 3566 cm.
    const echo = copterEcho(sent);
    echo[2] = { ...echo[2], z: Math.fround(3566 * Math.fround(0.01)) };
    expect(missionReadBackMatches(sent, echo, "ardupilot-copter")).toBe(true);
    echo[2] = { ...echo[2], z: Math.fround(3565 * Math.fround(0.01)) };
    expect(missionReadBackMatches(sent, echo, "ardupilot-copter")).toBe(false);
  });

  it("reads imported raw commands by the slots the vehicle keeps", () => {
    const zero = { current: 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: 0, y: 0, z: 0 };
    const sent: MissionItem[] = [
      homeItem({ lat: 47.1, lon: 8.1, alt: 410 }),
      { ...zero, seq: 1, command: 30, frame: 3, param1: 1, param2: 9, x: 471000000, y: 81000000, z: 40 },
      { ...zero, seq: 2, command: 31, frame: 3, param1: 5, param2: -60, param4: 1, x: 471000000, y: 81000000, z: 60 },
      { ...zero, seq: 3, command: 92, frame: 3, param1: 1, param2: 7, x: 471000000, y: 81000000, z: 40 },
      { ...zero, seq: 4, command: 181, frame: 2, param1: 2, param2: 1, param3: 4 },
      { ...zero, seq: 5, command: 191, frame: 3, param1: 3, x: 0, y: 0, z: 30 },
      { ...zero, seq: 6, command: 3000, frame: 2, param1: 4, param2: 1 },
    ];
    const echo: MissionItem[] = [
      sent[0],
      { ...sent[1], param2: 0 },
      { ...sent[2], param1: 0 },
      { ...sent[3], param2: 0 },
      { ...sent[4], frame: 0, param3: 0 },
      { ...sent[5], param1: 0 },
      { ...sent[6], frame: 0, param2: 0 },
    ];
    expect(missionReadBackMatches(sent, echo, "ardupilot-plane")).toBe(true);
    echo[6] = { ...echo[6], param1: 3 };
    expect(missionReadBackMatches(sent, echo, "ardupilot-plane")).toBe(false);
  });

  it("reads a Plane waypoint by its acceptance radius, not a delay", () => {
    const sent = [homeItem({ lat: 47.1, lon: 8.1, alt: 410 }), navItem({ ...leg, holdTime: undefined, param1: 30 }, 1, true, "relative")];
    const echo: MissionItem = { ...sent[1], param2: 30, param4: 0 };
    expect(missionReadBackMatches(sent, [sent[0], echo], "ardupilot-plane")).toBe(true);
    expect(missionReadBackMatches(sent, [sent[0], { ...echo, param2: 10 }], "ardupilot-plane")).toBe(false);
  });
});

describe("missionReadBackMatches elsewhere", () => {
  it("compares every slot of a PX4 copy", () => {
    const sent = sentMission().slice(1).map((item, seq) => ({ ...item, seq }));
    expect(missionReadBackMatches(sent, sent.map((item) => ({ ...item })), "px4")).toBe(true);
    const echo = sent.map((item) => ({ ...item }));
    echo[3] = { ...echo[3], x: 0, y: 0, z: 0 };
    expect(missionReadBackMatches(sent, echo, "px4")).toBe(false);
  });
});
