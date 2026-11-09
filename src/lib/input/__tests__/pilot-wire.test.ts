import { afterEach, describe, expect, it } from "vitest";

import fixtures from "./fixtures/pilot-requests.json";
import {
  PILOT_SRC,
  requestPilotAction,
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
// must match its fixture key for key, with `src` set to this surface's id.
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
  const want: Golden = { ...golden, src: PILOT_SRC };
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

  it("action", () => {
    const frames = capture();
    void requestPilotAction("hand_to_fc", fixtures.action.args, 10);
    expectWireEqual(frames[0], fixtures.action);
  });
});
