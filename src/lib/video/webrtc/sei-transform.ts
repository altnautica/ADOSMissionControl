/**
 * @module video/webrtc/sei-transform
 * @description Receiver-side frame instrumentation. Two things ride the same
 * `requestVideoFrameCallback` loop:
 *
 * 1. The SEI glass-to-glass probe. `RTCRtpScriptTransform` (no-op on browsers
 *    without the API) lets a worker read the air-side wall-clock stamp the
 *    agent splices into the bitstream, kept in a small
 *    (rtpTimestamp, seiMs, recvMs) ring and matched to each rendered frame.
 *    This is the only estimator that can see the camera-to-encoder leg, which
 *    is upstream of every timestamp the browser has.
 * 2. The per-hop receive budget in `@/lib/video/latency-budget`, derived from
 *    the frame metadata the user agent supplies directly. It needs no
 *    transform and no agent-side cooperation, so it works where the SEI probe
 *    does not — and it splits the receive path instead of yielding one number.
 *
 * The two are kept separate rather than folded into one field: they are
 * different estimators of overlapping quantities, and a surface that shows a
 * number has to be able to say which one produced it.
 *
 * @license GPL-3.0-only
 */

import { useVideoStore } from "@/stores/video-store";
import {
  observeFrameLatency,
  type FrameLatencyMetadata,
} from "../latency-budget";
import { getVideoElement } from "./session-state";

let seiWorker: Worker | null = null;

const SEI_RING_CAPACITY = 256;
interface SeiSample {
  rtpTimestamp: number;
  seiMs: number;
  recvMs: number;
}
const seiRing: SeiSample[] = [];
let seiAttachWarnedUnsupported = false;
let frameCallbackHandle: number | null = null;

function pushSeiSample(sample: SeiSample): void {
  seiRing.push(sample);
  if (seiRing.length > SEI_RING_CAPACITY) {
    seiRing.shift();
  }
}

function findSeiByRtpTimestamp(rtp: number): SeiSample | null {
  // Linear scan from newest to oldest. 256 entries on a 30 fps stream
  // means the worst-case match lives at the head; older entries fall
  // off cheaply.
  for (let i = seiRing.length - 1; i >= 0; i -= 1) {
    if (seiRing[i].rtpTimestamp === rtp) return seiRing[i];
  }
  return null;
}

/**
 * Install RTCRtpScriptTransform on the video receiver so the SEI
 * worker can read air-side timestamps as encoded frames arrive.
 * No-op on browsers that lack the API (Safari pre-17.4, Firefox).
 * The transform passes every frame through unmodified.
 */
export function attachSeiTransform(target: RTCPeerConnection): void {
  if (typeof window === "undefined") return;
  const Ctor = (window as unknown as {
    RTCRtpScriptTransform?: new (
      worker: Worker,
      options?: Record<string, unknown>,
    ) => unknown;
  }).RTCRtpScriptTransform;

  if (!Ctor) {
    if (!seiAttachWarnedUnsupported) {
      seiAttachWarnedUnsupported = true;
      console.info(
        "[webrtc-client] RTCRtpScriptTransform unavailable; true glass-to-glass disabled.",
      );
    }
    return;
  }

  const videoReceiver = target
    .getReceivers()
    .find((r) => r.track && r.track.kind === "video");
  if (!videoReceiver) return;

  try {
    if (seiWorker) {
      try { seiWorker.terminate(); } catch { /* noop */ }
    }
    seiWorker = new Worker(
      new URL("../sei-receiver-worker.ts", import.meta.url),
      { type: "module" },
    );
    seiWorker.onmessage = (e: MessageEvent<SeiSample>) => {
      const data = e.data;
      if (
        data &&
        typeof data.rtpTimestamp === "number" &&
        typeof data.seiMs === "number" &&
        typeof data.recvMs === "number"
      ) {
        pushSeiSample(data);
      }
    };
    seiWorker.onerror = (err) => {
      console.warn("[webrtc-client] sei worker error", err);
    };
    // The transform property is not in lib.dom yet; widen.
    (videoReceiver as unknown as { transform: unknown }).transform =
      new Ctor(seiWorker, { name: "ados-sei" });
  } catch (err) {
    console.warn(
      "[webrtc-client] attachSeiTransform failed; true glass-to-glass disabled",
      err,
    );
    if (seiWorker) {
      try { seiWorker.terminate(); } catch { /* noop */ }
      seiWorker = null;
    }
  }
}

export function detachSeiTransform(): void {
  if (frameCallbackHandle !== null && getVideoElement()) {
    // No public API to cancel a requestVideoFrameCallback handle
    // before it fires; the next callback simply early-returns when
    // the worker is gone.
    frameCallbackHandle = null;
  }
  if (seiWorker) {
    try { seiWorker.terminate(); } catch { /* noop */ }
    seiWorker = null;
  }
  seiRing.length = 0;
}

// requestVideoFrameCallback is present in modern Chromium/WebKit but not in
// lib.dom's declarations, and the WebRTC-source fields (captureTime,
// receiveTime, processingDuration) are absent from every published type. The
// metadata shape the budget module needs is declared there;
// `FrameLatencyMetadata` is reused here rather than kept as a second partial
// copy that could drift from the arithmetic that consumes it.
type FrameCb = (now: number, metadata: FrameLatencyMetadata) => void;
interface RvfcCarrier {
  requestVideoFrameCallback?: (cb: FrameCb) => number;
}

export function bindFrameCallback(el: HTMLVideoElement): void {
  const carrier = el as unknown as RvfcCarrier;
  const rvfc = carrier.requestVideoFrameCallback?.bind(el);
  if (typeof rvfc !== "function") return;

  const handler: FrameCb = (_now, metadata) => {
    if (el !== getVideoElement()) return; // element swapped, stop the loop

    // Per-hop receive budget. Needs no transform and no agent cooperation,
    // so this runs on every browser that implements the callback at all.
    observeFrameLatency(metadata);

    if (typeof metadata.rtpTimestamp === "number") {
      const match = findSeiByRtpTimestamp(metadata.rtpTimestamp);
      const offset =
        useVideoStore.getState().latency.clockOffsetMs ?? 0;
      if (match) {
        // Map the drone wall-clock SEI into the browser's monotonic
        // clock using the rolling offset estimate, then subtract from
        // the presentation moment to get camera→monitor latency.
        const seiBrowserMs = match.seiMs - offset;
        const trueG2GMs = metadata.presentationTime - seiBrowserMs;
        // Clamp obviously bogus values (clock-offset drift in the
        // first second after pairing, or a stale ring entry).
        if (trueG2GMs > 0 && trueG2GMs < 5_000) {
          useVideoStore.getState().recordG2GSample(trueG2GMs);
        } else if (process.env.NODE_ENV !== "production") {
          // Dev-mode breadcrumb: silent drops here would hide both the
          // first-sample ramp-up (offset still null/zero → negative
          // G2G) and any genuinely-long startup spikes that exceed 5s.
          // Worth seeing in the console without spamming production.
          console.debug("[webrtc-client] dropped G2G sample", {
            trueG2GMs,
            presentationTime: metadata.presentationTime,
            seiMs: match.seiMs,
            offset,
          });
        }
      }
    }
    frameCallbackHandle = rvfc(handler);
  };
  frameCallbackHandle = rvfc(handler);
}
