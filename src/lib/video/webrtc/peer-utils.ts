/**
 * @module video/webrtc/peer-utils
 * @description Shared peer-connection lifecycle helpers: the teardown
 * sequence the session registry runs when a connection stops being needed,
 * ICE restart with cooldown, and the health reporter that fans
 * transport-attempt state into the video store. The `closePeerConnection`
 * helper itself lives in `../webrtc-client.ts` so the cleanup-contract
 * regression test can source-scan a single file; this module re-exports it
 * under its canonical name for the per-flow modules to consume.
 * @license GPL-3.0-only
 */

import {
  useVideoStore,
  type TransportAttemptStage,
  type TransportErrorCode,
  type VideoTransport,
} from "@/stores/video-store";
import { resetLatencyBudget } from "../latency-budget";
import { closePeerConnection as closePeerConnectionImpl } from "../webrtc-client";
import { stopRecording } from "./recording";
import {
  getMediaRecorder,
  getPc,
  setSessionTeardown,
} from "./session-state";
import { stopStatsPolling } from "./stats-tracker";
import { detachSeiTransform } from "./sei-transform";

export const closePeerConnection = closePeerConnectionImpl;

/**
 * Everything that has to stop when a receive connection does, in order: the
 * recorder first (it is writing off the stream's tracks, and stopping those
 * tracks under it loses the tail), then the pollers and the frame
 * instrumentation, then the measured-latency window (percentiles carried
 * across a reconnect would describe a link that no longer exists), then the
 * connection itself, and finally the ICE-restart cooldown so the next
 * session is not gated by the previous one's.
 *
 * Registered here rather than in `lifecycle` because every per-flow module
 * imports this one, so the hook is armed before any flow can install a
 * session. It runs for a displaced session too, not only an explicit stop.
 */
setSessionTeardown((pc) => {
  if (getMediaRecorder()?.state === "recording") {
    stopRecording();
  }
  stopStatsPolling();
  detachSeiTransform();
  resetLatencyBudget();
  closePeerConnection(pc);
  resetIceRestartCooldown();
});

// ICE restart cooldown: only attempt once per 5 seconds to
// avoid thrash on flapping networks.
let lastIceRestartAt = 0;

/**
 * Attempt an ICE restart against the given peer connection. Refuses
 * when the connection has been replaced by a newer one (cascade may
 * have moved on to a different transport) or when the cooldown is
 * still active.
 */
export function tryIceRestart(targetPc: RTCPeerConnection): void {
  if (targetPc !== getPc()) return; // a newer pc has taken over
  if (targetPc.connectionState === "closed") return;
  if (typeof targetPc.restartIce !== "function") return; // older browsers
  const now = Date.now();
  if (now - lastIceRestartAt < 5000) return;
  lastIceRestartAt = now;
  try {
    targetPc.restartIce();
    console.log("[webrtc-client] ICE restart triggered after disconnect");
  } catch (err) {
    console.warn("[webrtc-client] ICE restart failed:", err);
  }
}

export function resetIceRestartCooldown(): void {
  lastIceRestartAt = 0;
}

/**
 * Report a per-transport health update into the video store. Used by
 * each per-flow module to thread the cascade UX (testing → ok → failed)
 * out of its inner control flow.
 */
export function reportHealth(
  transport: VideoTransport,
  patch: {
    state?: "testing" | "ok" | "failed";
    stage?: TransportAttemptStage;
    code?: TransportErrorCode;
    error?: string;
    connectMs?: number;
  },
): void {
  useVideoStore.getState().setTransportHealth(transport, {
    state: patch.state,
    lastAttemptStage: patch.stage ?? null,
    lastErrorCode: patch.code ?? null,
    lastError: patch.error ?? null,
    connectMs: patch.connectMs ?? null,
  });
}
