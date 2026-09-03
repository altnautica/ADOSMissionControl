/**
 * Regression net for the measured jitter-buffer target.
 *
 * The bug: `jitterBufferTarget = 50` hardcoded, described in the source as
 * "the FPV-grade default". No measurement produced 50, and it is wrong in
 * both directions — pure latency tax on a clean LAN, too shallow to conceal a
 * loss burst on a radio link.
 *
 * What has to hold: the target starts at "add nothing", moves only on
 * measured harm, cannot oscillate, cannot leave the spec's accepted range,
 * and the two receiver knobs get their values in their own units.
 */

import { describe, expect, it, vi } from "vitest";

import {
  applyJitterTarget,
  initialJitterState,
  jitterTargetForRung,
  nextJitterTarget,
  CLEAN_WINDOWS_TO_RELAX,
  JITTER_ESCALATE_MS,
  JITTER_TARGET_LADDER_MS,
  JITTER_TARGET_MAX_MS,
  MIN_DWELL_MS,
  type JitterSample,
} from "@/lib/video/webrtc/jitter-controller";

const CLEAN: Omit<JitterSample, "nowMs"> = {
  freezeDelta: 0,
  rtpJitterMs: 2,
  lossFraction: 0,
};

describe("jitter target ladder", () => {
  it("starts at zero: no buffer until something measured asks for one", () => {
    expect(initialJitterState().rung).toBe(0);
    expect(jitterTargetForRung(0)).toBe(0);
  });

  it("clamps a rung outside the ladder into the spec range", () => {
    // jitterBufferTarget throws RangeError outside [0, 4000].
    expect(jitterTargetForRung(-5)).toBe(0);
    expect(jitterTargetForRung(99)).toBe(
      JITTER_TARGET_LADDER_MS[JITTER_TARGET_LADDER_MS.length - 1],
    );
    expect(jitterTargetForRung(99)).toBeLessThanOrEqual(JITTER_TARGET_MAX_MS);
  });
});

describe("escalation on measured harm", () => {
  it("steps up on a reported freeze", () => {
    const decision = nextJitterTarget(initialJitterState(), {
      ...CLEAN,
      freezeDelta: 1,
      nowMs: 1_000,
    });
    expect(decision.reason).toBe("freeze");
    expect(decision.changed).toBe(true);
    expect(decision.targetMs).toBe(JITTER_TARGET_LADDER_MS[1]);
  });

  it("steps up on RTP jitter at or above a frame period", () => {
    const decision = nextJitterTarget(initialJitterState(), {
      ...CLEAN,
      rtpJitterMs: JITTER_ESCALATE_MS,
      nowMs: 1_000,
    });
    expect(decision.reason).toBe("jitter");
    expect(decision.targetMs).toBeGreaterThan(0);
  });

  it("steps up on packet loss above the threshold", () => {
    const decision = nextJitterTarget(initialJitterState(), {
      ...CLEAN,
      lossFraction: 0.05,
      nowMs: 1_000,
    });
    expect(decision.reason).toBe("loss");
  });

  it("does not step up on a quiet window", () => {
    const decision = nextJitterTarget(initialJitterState(), {
      ...CLEAN,
      nowMs: 1_000,
    });
    expect(decision.changed).toBe(false);
    expect(decision.targetMs).toBe(0);
  });

  it("stops at the top of the ladder", () => {
    let state = initialJitterState();
    let now = 0;
    for (let i = 0; i < JITTER_TARGET_LADDER_MS.length + 3; i += 1) {
      now += MIN_DWELL_MS;
      state = nextJitterTarget(state, { ...CLEAN, freezeDelta: 1, nowMs: now });
    }
    expect(state.rung).toBe(JITTER_TARGET_LADDER_MS.length - 1);
    expect(jitterTargetForRung(state.rung)).toBeLessThanOrEqual(
      JITTER_TARGET_MAX_MS,
    );
  });
});

describe("hysteresis", () => {
  it("refuses a second change inside the dwell window", () => {
    const first = nextJitterTarget(initialJitterState(), {
      ...CLEAN,
      freezeDelta: 1,
      nowMs: 10_000,
    });
    expect(first.changed).toBe(true);

    // Harm again, but only 500 ms later. A buffer resize costs a resync, so
    // changing faster than the link changes is cost with no benefit.
    const second = nextJitterTarget(first, {
      ...CLEAN,
      freezeDelta: 1,
      nowMs: 10_500,
    });
    expect(second.changed).toBe(false);
    expect(second.rung).toBe(first.rung);

    // Once the dwell has elapsed it escalates again.
    const third = nextJitterTarget(second, {
      ...CLEAN,
      freezeDelta: 1,
      nowMs: 10_000 + MIN_DWELL_MS,
    });
    expect(third.changed).toBe(true);
    expect(third.rung).toBe(first.rung + 1);
  });

  it("needs a sustained clean run to step back down, not one quiet second", () => {
    let state = nextJitterTarget(initialJitterState(), {
      ...CLEAN,
      freezeDelta: 1,
      nowMs: 0,
    });
    const escalated = state.rung;
    let now = MIN_DWELL_MS;

    // One clean window short of the requirement: still holding the depth.
    for (let i = 0; i < CLEAN_WINDOWS_TO_RELAX - 1; i += 1) {
      now += 1_000;
      state = nextJitterTarget(state, { ...CLEAN, nowMs: now });
      expect(state.rung).toBe(escalated);
    }

    now += 1_000;
    state = nextJitterTarget(state, { ...CLEAN, nowMs: now });
    expect(state.reason).toBe("sustained-clean");
    expect(state.rung).toBe(escalated - 1);
  });

  it("resets the clean run when harm reappears mid-run", () => {
    // Windows short enough that the whole sequence stays inside one dwell
    // period, so escalation is blocked and the RESET is the only thing the
    // assertion can be reading.
    const WINDOW_MS = 250;
    let now = 1_000;
    let state = nextJitterTarget(initialJitterState(), {
      ...CLEAN,
      freezeDelta: 1,
      nowMs: now,
    });
    const escalated = state.rung;
    expect(escalated).toBe(1);

    for (let i = 0; i < CLEAN_WINDOWS_TO_RELAX - 1; i += 1) {
      now += WINDOW_MS;
      state = nextJitterTarget(state, { ...CLEAN, nowMs: now });
    }
    expect(state.cleanWindows).toBe(CLEAN_WINDOWS_TO_RELAX - 1);

    // One bad window wipes the run. It cannot escalate either, because the
    // dwell has not elapsed.
    now += WINDOW_MS;
    state = nextJitterTarget(state, { ...CLEAN, freezeDelta: 1, nowMs: now });
    expect(state.cleanWindows).toBe(0);
    expect(state.rung).toBe(escalated);

    // And the clean run has to start over: one more quiet window is nowhere
    // near enough to give the depth back.
    now += WINDOW_MS;
    state = nextJitterTarget(state, { ...CLEAN, nowMs: now });
    expect(state.cleanWindows).toBe(1);
    expect(state.rung).toBe(escalated);
  });

  it("stays at the bottom of the ladder on a permanently clean link", () => {
    let state = initialJitterState();
    let now = 0;
    for (let i = 0; i < CLEAN_WINDOWS_TO_RELAX * 3; i += 1) {
      now += 1_000;
      state = nextJitterTarget(state, { ...CLEAN, nowMs: now });
    }
    expect(state.rung).toBe(0);
    expect(jitterTargetForRung(state.rung)).toBe(0);
  });
});

describe("applying the target to a receiver", () => {
  /**
   * The mock's own type, so every assertion reads a typed field instead of
   * asserting a shape at the point of use. The single `as unknown as
   * RTCRtpReceiver` sits at the boundary where the mock is handed to the
   * code under test.
   */
  interface TunableMock {
    track: { kind: string };
    jitterBufferTarget?: number;
    playoutDelayHint?: number;
  }

  function pcWith(mocks: TunableMock[]): RTCPeerConnection {
    const receivers = mocks.map((m) => m as unknown as RTCRtpReceiver);
    return { getReceivers: () => receivers } as unknown as RTCPeerConnection;
  }

  it("writes ms to jitterBufferTarget and SECONDS to playoutDelayHint", () => {
    const recv: TunableMock = {
      track: { kind: "video" },
      jitterBufferTarget: 0,
      playoutDelayHint: 0,
    };
    expect(applyJitterTarget(pcWith([recv]), 120)).toBe(1);
    // The two knobs are the same control in different units and different
    // vintages. Writing the ms value into the seconds property asks for a
    // buffer a thousand times too deep, and looks entirely plausible.
    expect(recv.jitterBufferTarget).toBe(120);
    expect(recv.playoutDelayHint).toBe(0.12);
  });

  it("clamps out-of-range requests instead of letting the setter throw", () => {
    const recv: TunableMock = {
      track: { kind: "video" },
      jitterBufferTarget: 0,
    };
    applyJitterTarget(pcWith([recv]), 99_999);
    expect(recv.jitterBufferTarget).toBe(JITTER_TARGET_MAX_MS);
  });

  it("reports zero tuned receivers when the browser has neither knob", () => {
    // WebKit implements neither and cannot be tuned from JS at all.
    // Reporting the requested value as applied would be a claim about a
    // buffer that never heard it.
    const recv: TunableMock = { track: { kind: "video" } };
    expect(applyJitterTarget(pcWith([recv]), 200)).toBe(0);
  });

  it("skips a non-video receiver", () => {
    const audio: TunableMock = {
      track: { kind: "audio" },
      jitterBufferTarget: 0,
    };
    expect(applyJitterTarget(pcWith([audio]), 200)).toBe(0);
    expect(audio.jitterBufferTarget).toBe(0);
  });

  it("survives a connection that throws from getReceivers", () => {
    const pc = {
      getReceivers: vi.fn(() => {
        throw new Error("closed");
      }),
    } as unknown as RTCPeerConnection;
    expect(applyJitterTarget(pc, 60)).toBe(0);
  });
});
