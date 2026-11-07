import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PILOT_SESSION_ID,
  handlePilotServerFrame,
  newSessionId,
  pilotStreamOpen,
  requestPilotAction,
  sendPilotAction,
  sendPilotInput,
  sendPilotRelease,
  setPilotSender,
  sticksRouteToFc,
  takePilotSession,
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
  usePilotLinkStore.getState().set({ controlMode: null, framesSent: 0, agentFor: null });
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
    expect(frames[0]).toMatchObject({ op: "action", name: "hand_to_fc", src: "mc", args: { mode: "loiter" } });
    expect(typeof (frames[0] as { id: unknown }).id).toBe("string");
  });

  it("an awaited action resolves with the pilot's answer for its id", async () => {
    const frames = capture();
    const refused = requestPilotAction("arm");
    const accepted = requestPilotAction("pause");
    const [a, b] = frames as Extract<PilotOutboundFrame, { op: "action" }>[];
    expect(a.id).not.toBe(b.id);
    handlePilotServerFrame("drone-1", { kind: "action_result", name: "pause", id: b.id, ok: true });
    handlePilotServerFrame("drone-1", { kind: "action_result", name: "arm", id: a.id, ok: false, err: "disarmed" });
    await expect(refused).resolves.toEqual({ ok: false, err: "disarmed" });
    await expect(accepted).resolves.toEqual({ ok: true });
  });

  it("an unanswered action fails after the timeout, and fails at once with no stream", async () => {
    vi.useFakeTimers();
    try {
      capture();
      const silent = requestPilotAction("land", undefined, 3000);
      vi.advanceTimersByTime(3001);
      await expect(silent).resolves.toMatchObject({ ok: false });
    } finally {
      vi.useRealTimers();
    }
    setPilotSender(null);
    await expect(requestPilotAction("rth")).resolves.toMatchObject({ ok: false });
  });
});

/**
 * The JSON frames a surface sends must decode with the agent's
 * `decode_request` (ados-protocol `pilot/wire.rs`): `input` needs src: string,
 * session/seq: u32, t_ms: u64, axes: [f32; 4], buttons: u32; `release` and
 * `session.take` need src and a u32 session; `action` needs name and src, with
 * an optional string id and object args.
 */
describe("pilot.v1 wire shape", () => {
  const isU32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
  const keys = (o: object) => Object.keys(o).sort();

  it("input, release, session.take and action survive JSON with the decoder's types", () => {
    const frames = capture();
    sendPilotInput([1, -1, 0.5, 0], 0b1010);
    sendPilotRelease();
    takePilotSession();
    sendPilotAction("launch", { after: "hold", alt_m: 3 });
    const [input, release, take, action] = frames.map((f) => JSON.parse(JSON.stringify(f)));

    expect(keys(input)).toEqual(["axes", "buttons", "op", "seq", "session", "src", "t_ms"]);
    expect(input.op).toBe("input");
    expect(typeof input.src).toBe("string");
    expect(isU32(input.session) && input.session !== 0).toBe(true);
    expect(isU32(input.seq)).toBe(true);
    expect(Number.isInteger(input.t_ms) && input.t_ms >= 0).toBe(true);
    expect(input.axes).toHaveLength(4);
    for (const a of input.axes) expect(Number.isFinite(a) && a >= -1 && a <= 1).toBe(true);
    expect(isU32(input.buttons)).toBe(true);

    for (const [f, op] of [[release, "release"], [take, "session.take"]] as const) {
      expect(keys(f)).toEqual(["op", "session", "src"]);
      expect(f.op).toBe(op);
      expect(f.session).toBe(input.session);
    }

    expect(keys(action)).toEqual(["args", "id", "name", "op", "src"]);
    expect(typeof action.id).toBe("string");
    expect(action.args).toEqual({ after: "hold", alt_m: 3 });
  });

  it("reads control_mode from pilot frames and reports the stream open", () => {
    capture();
    handlePilotServerFrame("drone-1", { kind: "pilot", data: { control_mode: "ados" } });
    expect(usePilotLinkStore.getState().controlMode).toBe("ados");
    expect(pilotStreamOpen("drone-1")).toBe(true);
    expect(pilotStreamOpen("drone-2")).toBe(false);
  });
});

describe("stick route to the flight controller", () => {
  it("a direct link always takes RC overrides", () => {
    expect(sticksRouteToFc("drone-1")).toBe(true);
  });
  it("an agent drone takes them only in fc_manual with the stream open", () => {
    usePilotLinkStore.getState().set({ agentFor: "drone-1" });
    expect(sticksRouteToFc("drone-1")).toBe(false);
    capture();
    for (const mode of ["ados", "elrs", null] as const) {
      usePilotLinkStore.getState().set({ controlMode: mode });
      expect(sticksRouteToFc("drone-1")).toBe(false);
    }
    usePilotLinkStore.getState().set({ controlMode: "fc_manual" });
    expect(sticksRouteToFc("drone-1")).toBe(true);
    setPilotSender(null);
    expect(sticksRouteToFc("drone-1")).toBe(false);
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
