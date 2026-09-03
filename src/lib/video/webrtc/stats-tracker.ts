/**
 * @module video/webrtc/stats-tracker
 * @description WebRTC stats polling. Computes fps, network RTT, decoder
 * jitter buffer wait, codec name, bitrate, and packet loss from a
 * periodic `pc.getStats()` sweep, then publishes a single atomic patch
 * to the video store.
 *
 * It is also the control loop for the receiver's jitter-buffer depth. The
 * same sweep already reads everything the decision needs — reported freezes,
 * RTP interarrival jitter, packet loss — so the depth is chosen from what
 * this connection measured rather than from a constant chosen once for every
 * link. See `./jitter-controller` for the law and the hysteresis.
 *
 * The polling state (`lastFramesDecoded`, `lastStatsTime`, etc.) lives
 * in `useVideoStore._pollState` so Turbopack HMR re-evaluating this
 * module does not reset the deltas to 0 mid-session.
 *
 * @license GPL-3.0-only
 */

import { useVideoStore } from "@/stores/video-store";
import {
  applyJitterTarget,
  initialJitterState,
  nextJitterTarget,
  type JitterControllerState,
} from "./jitter-controller";
import { getPc } from "./session-state";

let statsInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Jitter-buffer control state, and the counters the loop differentiates.
 *
 * `freezeCount` and the packet counters are cumulative for the life of the
 * connection, so the decision needs the delta over one window — a cumulative
 * read would keep escalating forever off a freeze that happened during
 * connection ramp-up and never recurred.
 */
let jitterState: JitterControllerState = initialJitterState();
let lastFreezeCount = 0;
let lastPacketsLost = 0;
let lastPacketsReceived = 0;
/** The depth currently asked of the receiver, for the diagnostics surface. */
let appliedJitterTargetMs = 0;

/** The jitter-buffer depth the loop last asked the receiver for, in ms. */
export function currentJitterTargetMs(): number {
  return appliedJitterTargetMs;
}

// Frozen-stream watchdog window. If neither framesDecoded nor
// bytesReceived advances for this long while pc.connectionState stays
// "connected", the stream has silently stalled (decoder wedge, transport
// freeze) without any connectionstatechange event. We tear down and
// re-fetch the offer.
const FROZEN_STREAM_TIMEOUT_MS = 7000;

// The watchdog only arms outside development. Turbopack HMR re-evaluates
// modules on unrelated edits, which can momentarily flatten the deltas and
// produce a false stall. In production there is no HMR, so the watchdog is
// safe to arm.
const WATCHDOG_ARMED = process.env.NODE_ENV === "production";

// When the page is hidden the browser legitimately pauses frame
// production for a backgrounded <video>. We reset the progress baseline on
// every visibility change so the watchdog never fires for a tab the user
// simply switched away from. Registered once per polling session.
let visibilityHandler: (() => void) | null = null;

function armVisibilityReset(): void {
  if (typeof document === "undefined" || visibilityHandler) return;
  visibilityHandler = () => {
    useVideoStore.getState().setPollState({ lastProgressTime: Date.now() });
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

function disarmVisibilityReset(): void {
  if (typeof document === "undefined" || !visibilityHandler) return;
  document.removeEventListener("visibilitychange", visibilityHandler);
  visibilityHandler = null;
}

/**
 * Stop polling, tear down the active stream, and raise the stall signal
 * so the owning video surface re-fetches the offer with backoff. Mirrors
 * the "failed"-path teardown in the per-flow modules (setStreaming(false)
 * + stopStatsPolling) and adds the one-way stall edge that the cascade
 * hook watches.
 */
function handleFrozenStream(): void {
  const store = useVideoStore.getState();
  stopStatsPolling();
  store.setStreaming(false);
  store.updateStats(0, 0);
  store.signalVideoStall();
}

/** Begin the 1 Hz stats poll. Idempotent. */
export function startStatsPolling(): void {
  if (statsInterval) return;

  // Reset polling state in the HMR-safe Zustand store
  useVideoStore.getState().resetPollState();
  useVideoStore.getState().setPollState({
    lastFrameTime: Date.now(),
    lastProgressTime: Date.now(),
  });
  // A new session starts the loop over. Carrying a rung across a reconnect
  // would apply the previous link's verdict to a link nobody has measured.
  jitterState = initialJitterState();
  lastFreezeCount = 0;
  lastPacketsLost = 0;
  lastPacketsReceived = 0;
  appliedJitterTargetMs = 0;
  armVisibilityReset();

  statsInterval = setInterval(async () => {
    const pc = getPc();
    if (!pc) return;

    const stats = await pc.getStats();
    const store = useVideoStore.getState();
    // Read persistent polling state from store
    const ps = store._pollState;
    const lastFramesDecoded = ps.lastFramesDecoded;
    const lastStatsTime = ps.lastStatsTime;
    const lastBytesReceived = ps.lastBytesReceived;
    const lastJitterDelay = ps.lastJitterDelay;
    const lastJitterEmitted = ps.lastJitterEmitted;

    // Single pass over the stats report. Collect codec entries by id while
    // also processing inbound-rtp and candidate-pair entries. Codec name is
    // resolved after the loop so we don't depend on iteration order.
    type CodecStatsLite = { id: string; type: string; mimeType?: string };
    const codecReports = new Map<string, CodecStatsLite>();

    let computedFps = 0;
    let inboundFound = false;
    let jitterMs = 0;
    let rttMs = 0;
    let framesDecoded = 0;
    let framesDropped = 0;
    let codecName = "";
    let bitrateKbps = 0;
    let packetsLost = 0;
    let inboundJitterRtpMs = 0;
    let bytesReceived = 0;
    let inboundCodecId: string | undefined;
    // Cumulative counters the jitter loop differentiates over this window.
    let freezeCount = 0;
    let packetsReceived = 0;

    stats.forEach((report) => {
      if (report.type === "codec") {
        codecReports.set(report.id, report as unknown as CodecStatsLite);
        return;
      }

      if (report.type === "inbound-rtp" && report.kind === "video") {
        inboundFound = true;

        type ExtendedInbound = RTCInboundRtpStreamStats & {
          framesPerSecond?: number;
          framesDecoded?: number;
          framesDropped?: number;
          jitterBufferDelay?: number;
          jitterBufferEmittedCount?: number;
          codecId?: string;
          bytesReceived?: number;
          packetsLost?: number;
          packetsReceived?: number;
          jitter?: number;
          /** Cumulative freezes the decoder reported. Chromium-only today. */
          freezeCount?: number;
        };
        const r = report as ExtendedInbound;

        // Prefer the browser-reported framesPerSecond, fall back to derived
        const reportedFps = r.framesPerSecond;
        const decoded = r.framesDecoded ?? 0;
        framesDecoded = decoded;
        framesDropped = r.framesDropped ?? 0;
        const now = Date.now();

        if (reportedFps !== undefined && reportedFps > 0) {
          computedFps = Math.round(reportedFps);
        } else if (lastStatsTime > 0 && decoded > lastFramesDecoded) {
          const elapsedSec = (now - lastStatsTime) / 1000;
          if (elapsedSec > 0) {
            computedFps = Math.round((decoded - lastFramesDecoded) / elapsedSec);
          }
        }

        // Decoder jitter buffer (L5). Use the delta over the last polling
        // window instead of the cumulative average. The cumulative ratio
        // gets pinned to whatever the buffer looked like during the
        // connection ramp-up, even if the stream is now smooth.
        const delay = r.jitterBufferDelay ?? 0;
        const emitted = r.jitterBufferEmittedCount ?? 0;
        if (emitted > lastJitterEmitted && lastJitterEmitted > 0) {
          const deltaDelay = delay - lastJitterDelay;
          const deltaEmitted = emitted - lastJitterEmitted;
          if (deltaEmitted > 0) {
            jitterMs = Math.round((deltaDelay / deltaEmitted) * 1000);
          }
        } else if (emitted > 0 && lastJitterEmitted === 0) {
          // First sample. Use cumulative as best available.
          jitterMs = Math.round((delay / emitted) * 1000);
        }
        // Persist for next window. Local mutation only; we batch the
        // store write at the bottom of this poll cycle.
        ps.lastJitterDelay = delay;
        ps.lastJitterEmitted = emitted;

        // Capture codec id; resolve mimeType after the loop completes.
        inboundCodecId = r.codecId;
        bytesReceived = r.bytesReceived ?? 0;
        packetsLost = r.packetsLost ?? 0;
        // r.jitter is in seconds (per spec)
        inboundJitterRtpMs = Math.round((r.jitter ?? 0) * 1000);
        packetsReceived = r.packetsReceived ?? 0;
        freezeCount = r.freezeCount ?? 0;
        return;
      }

      if (
        report.type === "candidate-pair" &&
        (report as RTCIceCandidatePairStats).state === "succeeded" &&
        (report as RTCIceCandidatePairStats).nominated
      ) {
        // Network round-trip (L4). Browser to mediamtx.
        const rttSec = (report as RTCIceCandidatePairStats).currentRoundTripTime ?? 0;
        rttMs = Math.round(rttSec * 1000);
      }
    });

    // Resolve codec mimeType after the single pass so iteration order
    // does not matter.
    if (inboundCodecId && codecReports.has(inboundCodecId)) {
      const codec = codecReports.get(inboundCodecId)!;
      // mimeType looks like "video/H264" or "video/VP8"
      const mime = codec.mimeType || "";
      codecName = mime.includes("/") ? mime.split("/")[1] : mime;
    }

    if (inboundFound) {
      // Roll-up latency = network RTT + decoder jitter buffer wait.
      // Keep updateStats(fps, latencyMs) for the existing badge readers
      // that only want a single number. The richer breakdown below
      // gives the popover what it needs to attribute time correctly.
      const totalLatencyMs = rttMs + jitterMs;
      store.updateStats(computedFps, totalLatencyMs);

      store.setReceiveLatency({
        rttMs,
        jitterBufferMs: jitterMs,
        rtpJitterMs: inboundJitterRtpMs,
        framesDecoded,
        framesDropped,
      });

      // Bitrate from byte delta over the polling interval
      if (lastStatsTime > 0 && bytesReceived > lastBytesReceived) {
        const elapsedSec = (Date.now() - lastStatsTime) / 1000;
        if (elapsedSec > 0) {
          const deltaBytes = bytesReceived - lastBytesReceived;
          bitrateKbps = Math.round((deltaBytes * 8) / elapsedSec / 1000);
        }
      }

      store.setVideoMetrics({
        codec: codecName,
        bitrateKbps,
        packetsLost,
        jitterMs: inboundJitterRtpMs > 0 ? inboundJitterRtpMs : jitterMs,
      });

      // Did anything actually advance this window? Either the decoder
      // consumed a new frame or the transport delivered new bytes. Used
      // by the frozen-stream watchdog below.
      const progressed =
        framesDecoded > lastFramesDecoded || bytesReceived > lastBytesReceived;

      // Persist polling state to the Zustand store. This single
      // setPollState call replaces module-global writes — the store is
      // HMR-safe so the next poll cycle (even after a Turbopack reload
      // of this module) reads the correct previous values.
      store.setPollState({
        lastFramesDecoded: framesDecoded,
        lastBytesReceived: bytesReceived,
        lastStatsTime: Date.now(),
        lastJitterDelay: ps.lastJitterDelay,
        lastJitterEmitted: ps.lastJitterEmitted,
        lastFrameTime: computedFps > 0 ? Date.now() : ps.lastFrameTime,
        lastProgressTime: progressed ? Date.now() : ps.lastProgressTime,
      });

      // Jitter-buffer control step. Deltas, not cumulative reads: a freeze
      // during connection ramp-up must not hold the buffer deep for the
      // rest of the flight. A counter that went backwards means the
      // connection was replaced, so the window is discarded rather than
      // read as a negative rate.
      const freezeDelta = Math.max(freezeCount - lastFreezeCount, 0);
      const lostDelta = Math.max(packetsLost - lastPacketsLost, 0);
      const receivedDelta = Math.max(packetsReceived - lastPacketsReceived, 0);
      lastFreezeCount = freezeCount;
      lastPacketsLost = packetsLost;
      lastPacketsReceived = packetsReceived;

      const decision = nextJitterTarget(jitterState, {
        freezeDelta,
        rtpJitterMs: inboundJitterRtpMs,
        lossFraction:
          lostDelta + receivedDelta > 0
            ? lostDelta / (lostDelta + receivedDelta)
            : 0,
        nowMs: Date.now(),
      });
      jitterState = decision;
      if (decision.changed) {
        const applied = applyJitterTarget(pc, decision.targetMs);
        // Only record the depth as applied when a receiver accepted it.
        // On a browser that implements neither property nothing changed,
        // and reporting the requested value would be a claim about the
        // buffer that the buffer never heard.
        appliedJitterTargetMs = applied > 0 ? decision.targetMs : 0;
        console.debug(
          `[video-latency] jitter target -> ${decision.targetMs}ms (${decision.reason}, ${applied} receiver(s))`,
        );
      }
    }

    // Frozen-stream watchdog. The native pc.onconnectionstatechange
    // handler detects transport-level disconnects, but a decoder wedge or
    // a silently-frozen transport keeps connectionState at "connected"
    // while frames and bytes both stop advancing — the user sees a frozen
    // last frame with no error. When neither counter has moved for the
    // timeout window, tear down and re-fetch the offer. The previous
    // frame-arrival timeout was removed because it false-triggered under
    // Turbopack HMR; this version only arms in production and resets its
    // baseline on visibility change, so the two failure modes do not
    // overlap.
    // A hidden tab legitimately pauses frame production for a backgrounded
    // <video>. Skip the stall judgement entirely while hidden, independent
    // of the visibilitychange baseline reset — a poll tick can race the
    // reset and otherwise misfire on the first tick after the tab un-hides.
    const pageHidden = typeof document !== "undefined" && document.hidden;
    if (WATCHDOG_ARMED && !pageHidden && pc.connectionState === "connected") {
      const sinceProgressMs = Date.now() - useVideoStore.getState()._pollState.lastProgressTime;
      if (sinceProgressMs > FROZEN_STREAM_TIMEOUT_MS) {
        handleFrozenStream();
      }
    }
  }, 1000);
}

export function stopStatsPolling(): void {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  disarmVisibilityReset();
}
