/**
 * @module video/webrtc/jitter-controller
 * @description Chooses the receiver's jitter-buffer target from what the
 * receiver has actually measured, instead of pinning it to a constant.
 *
 * ## Why the constant was wrong
 *
 * The WHEP flow used to set `jitterBufferTarget = 50` and call 50 ms "the
 * FPV-grade default". Nothing measured produced that number. It is
 * simultaneously too high for a clean wired LAN — where the honest measured
 * figure for this path is ~180 ms P50 / ~240 ms P95 end to end, of which the
 * media server contributes only 30-80 ms and the rest is encoder plus
 * receiver buffer, so 50 ms of *unconditional* buffer is 50 ms nobody asked
 * for — and too low for a lossy radio link, where a buffer smaller than the
 * recovery interval converts recoverable loss into a visible freeze. A single
 * constant cannot be right for both, and the receiver already has the
 * measurements needed to tell them apart.
 *
 * ## The loop
 *
 * Escalation is driven by *observed harm*, not by a jitter estimate alone: a
 * freeze the decoder actually reported, RTP interarrival jitter above a frame
 * period, or packet loss above a threshold. Relaxation needs a sustained
 * clean run, so a single quiet second cannot undo a step. Both directions are
 * gated by a minimum dwell so the buffer cannot oscillate, which would be
 * worse than either endpoint: a buffer that keeps resizing keeps resyncing.
 *
 * The ladder is coarse on purpose. Buffer depth only matters at the
 * granularity of a recovery interval, and a continuous controller on a 1 Hz
 * measurement would spend its time chasing noise.
 *
 * @license GPL-3.0-only
 */

/**
 * Buffer depths in ms, ascending. Rung 0 is "add nothing" — the correct
 * answer on a link with no measured harm. The steps above it are sized
 * against frame periods at 30 fps (33 ms): ~2 frames, ~4 frames, ~6 frames,
 * which is the range over which a receiver can conceal a loss burst without
 * the delay becoming the dominant term.
 */
export const JITTER_TARGET_LADDER_MS: readonly number[] = [0, 60, 120, 200];

/**
 * Spec range for `RTCRtpReceiver.jitterBufferTarget`. A value outside it
 * throws `RangeError`, so the ladder is clamped rather than trusted.
 */
export const JITTER_TARGET_MIN_MS = 0;
export const JITTER_TARGET_MAX_MS = 4000;

/**
 * Minimum time between two changes in either direction. A buffer resize
 * costs a resync, so changing faster than the link changes is a cost with no
 * benefit.
 */
export const MIN_DWELL_MS = 2000;

/**
 * RTP interarrival jitter above this is treated as harm. Just above one
 * frame period at 30 fps: below that the buffer has nothing to absorb.
 */
export const JITTER_ESCALATE_MS = 30;
/** And below this the link is quiet enough to consider stepping back down. */
export const JITTER_RELAX_MS = 15;

/** Loss fractions for the two directions. */
export const LOSS_ESCALATE = 0.02;
export const LOSS_RELAX = 0.005;

/** Consecutive clean windows required before stepping down one rung. */
export const CLEAN_WINDOWS_TO_RELAX = 5;

/** One poll window's worth of receiver measurements. */
export interface JitterSample {
  /** Freezes the decoder reported in this window (`freezeCount` delta). */
  freezeDelta: number;
  /** RTP interarrival jitter in ms (`inbound-rtp.jitter` × 1000). */
  rtpJitterMs: number;
  /** Lost / (lost + received) over this window. Negative or NaN reads as 0. */
  lossFraction: number;
  /** Monotonic-ish timestamp for the dwell gate. */
  nowMs: number;
}

export interface JitterControllerState {
  /** Index into {@link JITTER_TARGET_LADDER_MS}. */
  rung: number;
  /**
   * When the rung last moved; `null` before it ever has, so the first move
   * is free.
   *
   * `null`, not `0`. A sentinel that is also a legal timestamp means the
   * dwell gate silently disengages whenever the clock reads zero — which is
   * exactly what a monotonic clock, a faked timer, or a test does — and a
   * hysteresis that is off is indistinguishable from one that is on until
   * the buffer starts oscillating in the field.
   */
  lastChangeAtMs: number | null;
  /** Consecutive clean windows seen since the last non-clean one. */
  cleanWindows: number;
}

export interface JitterDecision extends JitterControllerState {
  /** The clamped buffer depth to apply, in ms. */
  targetMs: number;
  /** True when `targetMs` differs from the target before this sample. */
  changed: boolean;
  /** Why the rung moved, for the diagnostics surface. */
  reason: "freeze" | "jitter" | "loss" | "sustained-clean" | null;
}

/** Rung 0: the starting point is "assume nothing". */
export function initialJitterState(): JitterControllerState {
  return { rung: 0, lastChangeAtMs: null, cleanWindows: 0 };
}

/** Ladder depth for a rung, clamped into the spec's accepted range. */
export function jitterTargetForRung(rung: number): number {
  const idx = Math.min(
    Math.max(rung, 0),
    JITTER_TARGET_LADDER_MS.length - 1,
  );
  const raw = JITTER_TARGET_LADDER_MS[idx];
  return Math.min(Math.max(raw, JITTER_TARGET_MIN_MS), JITTER_TARGET_MAX_MS);
}

function normalizedLoss(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 1);
}

/**
 * One control step. Pure: same state plus same sample gives the same
 * decision, which is what makes the hysteresis testable without a browser.
 */
export function nextJitterTarget(
  state: JitterControllerState,
  sample: JitterSample,
): JitterDecision {
  const previousTarget = jitterTargetForRung(state.rung);
  const jitterMs = Number.isFinite(sample.rtpJitterMs)
    ? Math.max(sample.rtpJitterMs, 0)
    : 0;
  const loss = normalizedLoss(sample.lossFraction);
  const freezes = Number.isFinite(sample.freezeDelta)
    ? Math.max(sample.freezeDelta, 0)
    : 0;

  const harm: JitterDecision["reason"] | null =
    freezes > 0
      ? "freeze"
      : jitterMs >= JITTER_ESCALATE_MS
        ? "jitter"
        : loss >= LOSS_ESCALATE
          ? "loss"
          : null;

  const clean =
    freezes === 0 && jitterMs < JITTER_RELAX_MS && loss < LOSS_RELAX;
  const cleanWindows = clean ? state.cleanWindows + 1 : 0;

  // The dwell gate applies to the *change*, not to the measurement: harm seen
  // during the dwell window is still remembered by `cleanWindows` resetting,
  // so a link that is genuinely bad escalates on the next eligible tick.
  const dwellElapsed =
    state.lastChangeAtMs === null ||
    sample.nowMs - state.lastChangeAtMs >= MIN_DWELL_MS;

  const atTop = state.rung >= JITTER_TARGET_LADDER_MS.length - 1;
  const atBottom = state.rung <= 0;

  if (harm && dwellElapsed && !atTop) {
    const rung = state.rung + 1;
    return {
      rung,
      lastChangeAtMs: sample.nowMs,
      cleanWindows: 0,
      targetMs: jitterTargetForRung(rung),
      changed: jitterTargetForRung(rung) !== previousTarget,
      reason: harm,
    };
  }

  if (
    !harm &&
    cleanWindows >= CLEAN_WINDOWS_TO_RELAX &&
    dwellElapsed &&
    !atBottom
  ) {
    const rung = state.rung - 1;
    return {
      rung,
      lastChangeAtMs: sample.nowMs,
      cleanWindows: 0,
      targetMs: jitterTargetForRung(rung),
      changed: jitterTargetForRung(rung) !== previousTarget,
      reason: "sustained-clean",
    };
  }

  return {
    rung: state.rung,
    lastChangeAtMs: state.lastChangeAtMs,
    cleanWindows,
    targetMs: previousTarget,
    changed: false,
    reason: null,
  };
}

/**
 * Receiver-side latency knobs.
 *
 * The two are the same control in different units and different vintages:
 * `jitterBufferTarget` is the spec-named property and is in **milliseconds**;
 * `playoutDelayHint` is Chrome's older non-standard equivalent and is in
 * **seconds**. Setting the ms value on the seconds property asks for a buffer
 * a thousand times too deep, which is why the conversion is written once,
 * here, rather than at each call site.
 *
 * Declared standalone rather than extending `RTCRtpReceiver`: `lib.dom` has
 * `jitterBufferTarget` as a *required* `number | null`, so re-declaring it
 * optional on a subtype is a TS2430 conflict — and optional is the honest
 * shape, because `playoutDelayHint` is not in `lib.dom` at all and neither
 * property exists on a WebKit receiver.
 */
interface LatencyTunableReceiver {
  playoutDelayHint?: number | null;
  jitterBufferTarget?: number | null;
}

/**
 * Apply a target to every video receiver on the connection.
 *
 * Returns the number of receivers actually tuned, so a browser that
 * implements neither property (WebKit implements neither, and cannot be fixed
 * from JS at all) reports 0 rather than pretending the value took effect.
 */
export function applyJitterTarget(
  pc: RTCPeerConnection | null,
  targetMs: number,
): number {
  if (!pc) return 0;
  const clamped = Math.min(
    Math.max(targetMs, JITTER_TARGET_MIN_MS),
    JITTER_TARGET_MAX_MS,
  );
  let applied = 0;
  let receivers: RTCRtpReceiver[];
  try {
    receivers = pc.getReceivers();
  } catch {
    return 0;
  }
  for (const receiver of receivers) {
    if (receiver.track && receiver.track.kind !== "video") continue;
    // Two properties `lib.dom` either types differently or does not know at
    // all; the runtime `in` checks below are the actual test.
    const tunable = receiver as unknown as LatencyTunableReceiver;
    let touched = false;
    try {
      if ("jitterBufferTarget" in tunable) {
        tunable.jitterBufferTarget = clamped;
        touched = true;
      }
      if ("playoutDelayHint" in tunable) {
        // Seconds, not milliseconds.
        tunable.playoutDelayHint = clamped / 1000;
        touched = true;
      }
    } catch {
      // A browser that exposes the property but rejects the value: leave it
      // at whatever it had rather than half-applying the pair.
      touched = false;
    }
    if (touched) applied += 1;
  }
  return applied;
}
