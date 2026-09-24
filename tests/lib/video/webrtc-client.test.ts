import { describe, expect, it, vi } from "vitest";

import { closePeerConnection, onPeerConnectionClose } from "@/lib/video/webrtc-client";

/**
 * The PeerConnection teardown contract. Safari leaves MediaStreamTracks
 * "live" after pc.close() unless every receiver and sender track is stopped
 * first, which holds the camera permission and re-prompts on the next start.
 * Handlers are cleared before close() so the teardown's own "closed" state
 * change does not re-enter store updates.
 */

interface FakePc {
  ontrack: unknown;
  onconnectionstatechange: unknown;
  onicecandidateerror: unknown;
  oniceconnectionstatechange: unknown;
  onicegatheringstatechange: unknown;
  onsignalingstatechange: unknown;
  getReceivers: () => { track: { stop: () => void } | null }[];
  getSenders: () => { track: { stop: () => void } | null }[];
  close: () => void;
}

function fakePc(events: string[]): FakePc {
  const track = (name: string) => ({ stop: () => events.push(`stop:${name}`) });
  const handler = () => events.push("handler-fired");
  return {
    ontrack: handler,
    onconnectionstatechange: handler,
    onicecandidateerror: handler,
    oniceconnectionstatechange: handler,
    onicegatheringstatechange: handler,
    onsignalingstatechange: handler,
    getReceivers: () => [{ track: track("video-rx") }, { track: null }],
    getSenders: () => [{ track: track("audio-tx") }],
    close() {
      events.push(this.onconnectionstatechange === null ? "close:handlers-cleared" : "close:handlers-live");
    },
  };
}

const asPc = (pc: FakePc) => pc as unknown as RTCPeerConnection;

describe("closePeerConnection", () => {
  it("stops every receiver and sender track before closing, with handlers cleared", () => {
    const events: string[] = [];
    const pc = fakePc(events);

    closePeerConnection(asPc(pc));

    expect(events).toEqual(["stop:video-rx", "stop:audio-tx", "close:handlers-cleared"]);
    for (const key of ["ontrack", "onconnectionstatechange", "onicecandidateerror", "oniceconnectionstatechange", "onicegatheringstatechange", "onsignalingstatechange"] as const) {
      expect(pc[key]).toBeNull();
    }
  });

  it("still closes when a track refuses to stop", () => {
    const events: string[] = [];
    const pc = fakePc(events);
    pc.getReceivers = () => [{ track: { stop: () => { throw new Error("already ended"); } } }];

    closePeerConnection(asPc(pc));

    expect(events).toContain("close:handlers-cleared");
  });

  it("runs the registered close hook exactly once", () => {
    const pc = fakePc([]);
    const hook = vi.fn();
    onPeerConnectionClose(asPc(pc), hook);

    closePeerConnection(asPc(pc));
    closePeerConnection(asPc(pc));

    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("ignores a null connection", () => {
    expect(() => closePeerConnection(null)).not.toThrow();
  });
});
