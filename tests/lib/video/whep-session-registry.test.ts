/**
 * Regression net for shared-receive-session ownership.
 *
 * The bug: `startStream` opened by unconditionally closing whatever peer
 * connection was installed, and four surfaces render the same feed through
 * it (cockpit VideoCanvas, focused-drone VideoFeedCard, HDMI-kiosk
 * VideoBackground, context-rail MiniVideoView). So mounting the second
 * surface killed the first surface's video, and either surface's unmount tore
 * down the survivor. One stream, N negotiations, N-1 black panes.
 *
 * These tests exercise the registry directly rather than the flows, because
 * the flows need an `RTCPeerConnection` and a WHEP endpoint while the
 * *ownership* rules are the thing that has to hold.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireSession,
  installSession,
  releaseSession,
  resetSessionStateForTest,
  sessionSnapshot,
  setSessionTeardown,
  whepSessionKey,
  getPc,
} from "@/lib/video/webrtc/session-state";

/** A peer connection stand-in: only the fields the registry reads. */
function fakePc(connectionState: RTCPeerConnectionState = "connected") {
  return { connectionState } as unknown as RTCPeerConnection;
}

/** A media stream stand-in with one live video track. */
function fakeStream(readyState: MediaStreamTrackState = "live"): MediaStream {
  const track = { kind: "video", readyState } as unknown as MediaStreamTrack;
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

const KEY_A = whepSessionKey("http://192.168.1.50:8889/main/whep");
const KEY_B = whepSessionKey("http://192.168.1.50:8889/ir/whep");

let closed: RTCPeerConnection[] = [];

beforeEach(() => {
  resetSessionStateForTest();
  closed = [];
  setSessionTeardown((pc) => {
    if (pc) closed.push(pc);
  });
});

describe("shared session identity and leases", () => {
  it("negotiates once and shares the live session for the same stream", async () => {
    const pc = fakePc();
    const stream = fakeStream();
    const negotiate = vi.fn(async () => {
      installSession(KEY_A, pc, stream);
      return stream;
    });

    const first = await acquireSession(KEY_A, undefined, negotiate);
    const second = await acquireSession(KEY_A, undefined, negotiate);

    // The second surface got the SAME stream object off ONE negotiation.
    expect(second).toBe(first);
    expect(negotiate).toHaveBeenCalledTimes(1);
    const snap = sessionSnapshot();
    expect(snap.negotiations).toBe(1);
    expect(snap.sharedLive).toBe(1);
    expect(snap.leases).toBe(2);
    // And crucially: nothing was closed to make room for the second surface.
    expect(closed).toEqual([]);
  });

  it("joins an in-flight negotiation instead of starting a second one", async () => {
    const pc = fakePc();
    const stream = fakeStream();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const negotiate = vi.fn(async () => {
      await gate;
      installSession(KEY_A, pc, stream);
      return stream;
    });

    const a = acquireSession(KEY_A, undefined, negotiate);
    // Same tick, before the first resolves: this is the mount race between
    // two surfaces that both want the feed.
    const b = acquireSession(KEY_A, undefined, negotiate);
    expect(sessionSnapshot().pendingWaiters).toBe(2);

    release();
    expect(await a).toBe(stream);
    expect(await b).toBe(stream);
    expect(negotiate).toHaveBeenCalledTimes(1);
    expect(sessionSnapshot().sharedPending).toBe(1);
  });

  it("keeps the handshake alive when one of two waiters aborts", async () => {
    const pc = fakePc();
    const stream = fakeStream();
    const seenSignals: AbortSignal[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const negotiate = async (signal: AbortSignal) => {
      seenSignals.push(signal);
      await gate;
      installSession(KEY_A, pc, stream);
      return stream;
    };

    const controller = new AbortController();
    const abandoned = acquireSession(KEY_A, controller.signal, negotiate);
    const kept = acquireSession(KEY_A, undefined, negotiate);

    controller.abort();
    await expect(abandoned).rejects.toThrow();
    // The negotiation's own signal is untouched: one surface walking away
    // must not cancel a handshake another surface is still waiting on.
    expect(seenSignals[0].aborted).toBe(false);

    release();
    expect(await kept).toBe(stream);
  });

  it("only tears down on the last release, and ignores an unheld release", async () => {
    const pc = fakePc();
    const stream = fakeStream();
    const negotiate = async () => {
      installSession(KEY_A, pc, stream);
      return stream;
    };
    await acquireSession(KEY_A, undefined, negotiate);
    await acquireSession(KEY_A, undefined, negotiate);

    // First surface unmounts.
    expect(releaseSession()).toBe(false);
    expect(closed).toEqual([]);
    expect(getPc()).toBe(pc);

    // Second surface unmounts: now it goes.
    expect(releaseSession()).toBe(true);
    expect(closed).toEqual([pc]);

    // A cleanup path that never acquired must not tear anything down. Several
    // cascade cleanup branches do exactly this.
    expect(releaseSession()).toBe(false);
    expect(closed).toEqual([pc]);
  });

  it("re-negotiates when the installed session's track has ended", async () => {
    const deadPc = fakePc("connected");
    const deadStream = fakeStream("ended");
    installSession(KEY_A, deadPc, deadStream);

    const livePc = fakePc();
    const liveStream = fakeStream();
    const negotiate = vi.fn(async () => {
      installSession(KEY_A, livePc, liveStream);
      return liveStream;
    });

    // A connection sitting at "connected" with a dead track is not a stream.
    // Handing it to a second surface is a permanently black pane, no error.
    expect(await acquireSession(KEY_A, undefined, negotiate)).toBe(liveStream);
    expect(negotiate).toHaveBeenCalledTimes(1);
    expect(closed).toEqual([deadPc]);
    // Replacing a dead session is routine, not a displacement worth warning
    // an operator about.
    expect(sessionSnapshot().displaced).toBe(0);
  });
});

describe("displacement by a different stream", () => {
  it("does not evict the incumbent until the replacement has a track", async () => {
    const pcA = fakePc();
    const streamA = fakeStream();
    await acquireSession(KEY_A, undefined, async () => {
      installSession(KEY_A, pcA, streamA);
      return streamA;
    });

    // A negotiation for a different leg starts and FAILS. The working feed
    // must survive it — pre-emptive teardown made a failed attempt blank a
    // surface permanently.
    await expect(
      acquireSession(KEY_B, undefined, async () => {
        throw new Error("WHEP 404");
      }),
    ).rejects.toThrow("WHEP 404");

    expect(closed).toEqual([]);
    expect(getPc()).toBe(pcA);
    expect(sessionSnapshot().key).toBe(KEY_A);
  });

  it("counts and warns when a still-held session is displaced", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pcA = fakePc();
    const streamA = fakeStream();
    await acquireSession(KEY_A, undefined, async () => {
      installSession(KEY_A, pcA, streamA);
      return streamA;
    });

    const pcB = fakePc();
    const streamB = fakeStream();
    await acquireSession(KEY_B, undefined, async () => {
      installSession(KEY_B, pcB, streamB);
      return streamB;
    });

    expect(closed).toEqual([pcA]);
    expect(sessionSnapshot().displaced).toBe(1);
    expect(sessionSnapshot().key).toBe(KEY_B);
    // Silently blanking another surface is the failure the registry exists to
    // stop; when it is genuinely unavoidable it has to be observable.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("negotiating connection versus installed session", () => {
  it("does not orphan the installed connection while a handshake runs", async () => {
    const { setPc } = await import("@/lib/video/webrtc/session-state");
    const pcA = fakePc();
    const streamA = fakeStream();
    await acquireSession(KEY_A, undefined, async () => {
      installSession(KEY_A, pcA, streamA);
      return streamA;
    });

    const pcB = fakePc("connecting");
    // Mid-handshake, `getPc()` follows the new connection so the per-flow
    // "am I still current" guards work...
    setPc(pcB);
    expect(getPc()).toBe(pcB);
    // ...and the incumbent is still owned, not leaked.
    expect(closed).toEqual([]);

    // The handshake fails and clears its mark: `getPc()` must fall back to
    // the session that was working all along.
    setPc(null);
    expect(getPc()).toBe(pcA);
    expect(sessionSnapshot().leases).toBe(1);
  });
});
