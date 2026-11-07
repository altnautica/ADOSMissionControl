import { afterEach, describe, expect, it } from "vitest";

import {
  PILOT_SESSION_ID,
  handlePilotServerFrame,
  newSessionId,
  pilotStreamOpen,
  sendPilotAction,
  sendPilotInput,
  sendPilotRelease,
  setPilotSender,
  usePilotLinkStore,
  type PilotOutboundFrame,
} from "../pilot-stream";
import { radialDeadzone } from "../gamepad-poller";

function capture(): PilotOutboundFrame[] {
  const frames: PilotOutboundFrame[] = [];
  setPilotSender((f) => {
    frames.push(f);
    return true;
  }, "drone-1");
  return frames;
}

afterEach(() => {
  setPilotSender(null);
  usePilotLinkStore.getState().set({ controlMode: null, framesSent: 0 });
});

describe("pilot stream frames (pilot.v1)", () => {
  it("input frames carry src, session, rising seq and the axes", () => {
    const frames = capture();
    sendPilotInput([0.1, 0.2, 0.3, -0.4], 5);
    sendPilotInput([0, 0, 0, 0], 0);
    expect(frames).toHaveLength(2);
    const [a, b] = frames as Extract<PilotOutboundFrame, { op: "input" }>[];
    expect(a).toMatchObject({ op: "input", src: "mc", session: PILOT_SESSION_ID, axes: [0.1, 0.2, 0.3, -0.4], buttons: 5 });
    expect(b.seq).toBe(a.seq + 1);
    expect(usePilotLinkStore.getState().streaming).toBe(true);
  });

  it("names the session with a non-zero u32, as pilot.v1 decodes it", () => {
    expect(Number.isInteger(PILOT_SESSION_ID)).toBe(true);
    expect(PILOT_SESSION_ID).toBeGreaterThan(0);
    expect(PILOT_SESSION_ID).toBeLessThanOrEqual(0xffffffff);
    for (let i = 0; i < 100; i++) {
      const id = newSessionId();
      expect(Number.isInteger(id) && id > 0 && id <= 0xffffffff).toBe(true);
    }
  });

  it("release is sent once per stop", () => {
    const frames = capture();
    sendPilotInput([0, 0, 0, 0], 0);
    expect(sendPilotRelease()).toBe(true);
    expect(sendPilotRelease()).toBe(false);
    expect(frames.filter((f) => f.op === "release")).toHaveLength(1);
  });

  it("actions are sent with args", () => {
    const frames = capture();
    sendPilotAction("hand_to_fc", { mode: "loiter" });
    expect(frames[0]).toEqual({ op: "action", name: "hand_to_fc", src: "mc", args: { mode: "loiter" } });
  });

  it("reads control_mode from pilot frames and reports the stream open", () => {
    capture();
    handlePilotServerFrame("drone-1", { kind: "pilot", data: { control_mode: "ados" } });
    expect(usePilotLinkStore.getState().controlMode).toBe("ados");
    expect(pilotStreamOpen("drone-1")).toBe(true);
    expect(pilotStreamOpen("drone-2")).toBe(false);
  });
});

describe("radialDeadzone", () => {
  it("zeroes inside the deadzone and keeps full deflection at 1", () => {
    expect(radialDeadzone(0.05, 0.05, 0.08)).toEqual([0, 0]);
    const [x] = radialDeadzone(1, 0, 0.08);
    expect(x).toBeCloseTo(1);
    const [hx] = radialDeadzone(0.54, 0, 0.08);
    expect(hx).toBeCloseTo(0.5);
  });
});
