/**
 * @module video/webrtc/lifecycle
 * @description Cross-flow lifecycle helpers: release a hold on the shared
 * stream, bind a video element for screenshot/recording reference, and the
 * is-stream-active probe that consumers use to gate UI affordances.
 * @license GPL-3.0-only
 */

import { useVideoStore } from "@/stores/video-store";
import { bindFrameCallback } from "./sei-transform";
import {
  getPc,
  releaseSession,
  setVideoElementRef,
} from "./session-state";
// Imported for its module-level side effect as well as nothing else: it is
// where the session registry's teardown sequence is registered.
import "./peer-utils";

/**
 * Release this caller's hold on the shared receive session.
 *
 * Not "stop the stream" any more, and that is the point. Four surfaces
 * render the same feed, and an unconditional teardown here meant whichever
 * one unmounted first blanked the others. The connection is torn down when
 * the last hold goes, by the registry; a release from a caller that never
 * acquired — several cascade cleanup paths do exactly that, because the
 * cleanup runs even for an effect run that bailed before connecting — is a
 * no-op.
 *
 * The store reset only runs on real teardown, so a surface unmounting does
 * not blank the transport badge and latency readout of a surface that is
 * still streaming.
 */
export async function stopStream(): Promise<void> {
  if (!releaseSession()) return;

  const store = useVideoStore.getState();
  store.setStreaming(false);
  store.setStreamUrl(null);
  store.updateStats(0, 0);
  store.setTransport("unknown");
  store.setVideoMetrics({ codec: "", bitrateKbps: 0, packetsLost: 0, jitterMs: 0 });
  store.resetLatency();
}

// Tracks the element + handler for the loadedmetadata listener so a re-bind
// or unbind detaches the previous one instead of stacking listeners on a
// reused <video> element across mounts.
let metadataEl: HTMLVideoElement | null = null;
let metadataHandler: (() => void) | null = null;

/** Bind a video element for screenshot/recording reference. */
export function setVideoElement(el: HTMLVideoElement | null): void {
  setVideoElementRef(el);

  if (metadataEl && metadataHandler) {
    metadataEl.removeEventListener("loadedmetadata", metadataHandler);
    metadataEl = null;
    metadataHandler = null;
  }

  if (el) {
    // Track resolution changes
    metadataEl = el;
    metadataHandler = () => {
      useVideoStore
        .getState()
        .setResolution(`${el.videoWidth}x${el.videoHeight}`);
    };
    el.addEventListener("loadedmetadata", metadataHandler);
    // Hook requestVideoFrameCallback for the per-hop latency budget and the
    // SEI-driven true G2G computation. No-op when the browser lacks the API.
    bindFrameCallback(el);
  }
}

/** Check if a stream is currently active. */
export function isStreamActive(): boolean {
  const current = getPc();
  return current !== null && current.connectionState === "connected";
}
