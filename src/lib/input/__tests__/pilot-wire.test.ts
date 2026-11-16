import { afterEach, describe, expect, it } from "vitest";

import fixtures from "./fixtures/pilot-requests.json";
import {
  PILOT_SID,
  PILOT_SRC,
  requestPilotAction,
  sendPilotBye,
  sendPilotHeartbeat,
  sendPilotInput,
  sendPilotRelease,
  setPilotSender,
  takePilotSession,
  usePilotLinkStore,
  type PilotOutboundFrame,
} from "../pilot-stream";

// `fixtures/pilot-requests.json` is a byte copy of the agent's golden client
// frames (`crates/ados-control/tests/fixtures/pilot-requests.json`), which
// the agent's `pilot.v1` decoder test parses. Every frame this surface encodes
// must match its fixture key for key, with `src` set to this surface's id
// and `sid` to this tab's instance id (same shape as the fixture's).
// Per-session values (session, seq, t_ms, id) are compared by type.

type Golden = Record<string, unknown>;
const VOLATILE: Record<string, true> = { session: true, seq: true, t_ms: true, id: true };

function capture(): PilotOutboundFrame[] {
  const frames: PilotOutboundFrame[] = [];
  setPilotSender((f) => {
    frames.push(f);
    return true;
  }, "drone-1");
  return frames;
}

function expectWireEqual(frame: PilotOutboundFrame, golden: Golden): void {
  expect(golden.sid).toMatch(/^[0-9a-f]{32}$/);
  const want: Golden = { ...golden, src: PILOT_SRC, sid: PILOT_SID };
  const got = JSON.parse(JSON.stringify(frame)) as Golden;
  expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
  for (const [k, v] of Object.entries(want)) {
    if (VOLATILE[k]) expect(typeof got[k]).toBe(typeof v);
    else expect(got[k]).toEqual(v);
  }
}

afterEach(() => {
  setPilotSender(null);
  usePilotLinkStore.getState().set({ streaming: false, framesSent: 0 });
});

describe("pilot.v1 wire frames match the agent's golden fixtures", () => {
  it("input", () => {
    const frames = capture();
    const g = fixtures.input;
    sendPilotInput(g.axes as [number, number, number, number], g.buttons);
    expectWireEqual(frames[0], g);
  });

  it("release", () => {
    const frames = capture();
    sendPilotInput([0, 0, 0, 0], 0);
    sendPilotRelease();
    expectWireEqual(frames[1], fixtures.release);
  });

  it("session.take", () => {
    const frames = capture();
    takePilotSession();
    expectWireEqual(frames[0], fixtures.session_take);
  });

  it("hb", () => {
    const frames = capture();
    sendPilotHeartbeat();
    expectWireEqual(frames[0], fixtures.hb);
  });

  it("bye", () => {
    const frames = capture();
    sendPilotBye();
    expectWireEqual(frames[0], fixtures.bye);
  });

  it("action", () => {
    const frames = capture();
    void requestPilotAction("hand_to_fc", fixtures.action.args, 10);
    expectWireEqual(frames[0], fixtures.action);
  });

  it("action goto (Fly Here)", () => {
    const frames = capture();
    void requestPilotAction("goto", fixtures.goto.args, 10);
    expectWireEqual(frames[0], fixtures.goto);
  });
});
