import { beforeEach, describe, expect, it } from "vitest";

import {
  EMPTY_INPUTS,
  computeMissionState,
  useMissionStateStore,
  type MissionInputs,
} from "../mission-state";

const NOW = 1_000_000;
const copter = (over: Partial<MissionInputs>): MissionInputs => ({
  ...EMPTY_INPUTS,
  firmware: "ardupilot-copter",
  total: 5,
  missionCurrentAt: NOW,
  ...over,
});

describe("computeMissionState (C8)", () => {
  it("none when there is no mission", () => {
    expect(computeMissionState(copter({ total: 0 }), NOW).status.state).toBe("none");
    expect(computeMissionState(copter({ total: 0xffff }), NOW).status.state).toBe("none");
    expect(computeMissionState(copter({ missionState: 1 }), NOW).status.state).toBe("none");
  });

  it("active from mission_state while armed in AUTO, source mission_state", () => {
    const r = computeMissionState(copter({ armed: true, customMode: 3, missionState: 3, seq: 1 }), NOW);
    expect(r.status.state).toBe("active");
    expect(r.status.source).toBe("mission_state");
    expect(r.latched).toBe(true);
  });

  it("fallback active on ArduPilot <= 4.4 (no mission_state) with seq >= 1", () => {
    const r = computeMissionState(copter({ armed: true, customMode: 3, missionState: null, seq: 2 }), NOW);
    expect(r.status.state).toBe("active");
    expect(r.status.source).toBe("fallback");
  });

  it("stale MISSION_CURRENT is not trusted for mission_state", () => {
    const r = computeMissionState(
      copter({ armed: true, customMode: 3, missionState: 4, seq: 1, missionCurrentAt: NOW - 4000 }),
      NOW,
    );
    expect(r.status.source).toBe("fallback");
    expect(r.status.state).toBe("active");
  });

  it("AUTO_RTL (27) is active with landing_seq", () => {
    const r = computeMissionState(copter({ armed: true, customMode: 27, missionState: 3, seq: 4 }), NOW);
    expect(r.status.state).toBe("active");
    expect(r.status.landingSeq).toBe(true);
  });

  it("paused by ap_pause in AUTO, and by a hold mode after active", () => {
    expect(
      computeMissionState(copter({ armed: true, customMode: 3, seq: 2, apPause: true }), NOW).status.state,
    ).toBe("paused");
    expect(
      computeMissionState(copter({ armed: true, customMode: 5, seq: 2, latched: true }), NOW).status.state,
    ).toBe("paused");
    // LOITER without a latched mission is not a paused mission.
    expect(computeMissionState(copter({ armed: true, customMode: 5, seq: 2 }), NOW).status.state).toBe("loaded");
  });

  it("returning in RTL after the mission ran; loaded before", () => {
    expect(
      computeMissionState(copter({ armed: true, customMode: 6, latched: true }), NOW).status.state,
    ).toBe("returning");
    expect(computeMissionState(copter({ armed: true, customMode: 6 }), NOW).status.state).toBe("loaded");
  });

  it("complete on the last item reached and stays latched", () => {
    const r = computeMissionState(copter({ armed: true, customMode: 3, seq: 4, itemReached: 4, latched: true }), NOW);
    expect(r.status.state).toBe("complete");
    expect(computeMissionState(copter({ armed: true, customMode: 5, completeLatched: r.completeLatched }), NOW).status.state).toBe("complete");
  });

  it("plane numbers: AUTO 10 active, QLOITER 19 hold, RTL 11 returning", () => {
    const plane = (o: Partial<MissionInputs>) => copter({ firmware: "ardupilot-plane", ...o });
    expect(computeMissionState(plane({ armed: true, customMode: 10, seq: 1 }), NOW).status.state).toBe("active");
    expect(computeMissionState(plane({ armed: true, customMode: 19, latched: true }), NOW).status.state).toBe("paused");
    expect(computeMissionState(plane({ armed: true, customMode: 11, latched: true }), NOW).status.state).toBe("returning");
  });

  it("PX4 AUTO.MISSION (main 4 sub 4) is active", () => {
    const mode = (4 << 16) | (4 << 24);
    const r = computeMissionState(copter({ firmware: "px4", armed: true, customMode: mode >>> 0, seq: 1 }), NOW);
    expect(r.status.state).toBe("active");
  });
});

describe("useMissionStateStore", () => {
  beforeEach(() => useMissionStateStore.setState({ inputs: {}, status: {} }));

  it("disarm clears the latches", () => {
    const s = useMissionStateStore.getState();
    s.observe("d", { firmware: "ardupilot-copter", total: 5, armed: true, customMode: 3, seq: 1, missionCurrentAt: NOW }, NOW);
    expect(useMissionStateStore.getState().status.d.state).toBe("active");
    s.observe("d", { customMode: 6 }, NOW);
    expect(useMissionStateStore.getState().status.d.state).toBe("returning");
    s.observe("d", { armed: false }, NOW);
    expect(useMissionStateStore.getState().status.d.state).toBe("loaded");
  });
});
