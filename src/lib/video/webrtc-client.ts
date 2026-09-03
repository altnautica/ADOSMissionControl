/**
 * @module video/webrtc-client
 * @description Barrel re-export of the WebRTC video stream client. The
 * per-flow modules (LAN WHEP, MQTT-relayed P2P), the SEI receiver
 * worker plumbing, the stats poller and jitter-buffer control loop, the
 * recording surface, and the shared session registry live under
 * `src/lib/video/webrtc/`.
 *
 * Connects to a mediamtx server via WHEP for low-latency H.264/H.265
 * video. Provides:
 * - Stream acquisition and release (LAN-direct + MQTT-relayed P2P), deduped
 *   by stream identity so the surfaces that render the same feed share one
 *   connection instead of closing each other's
 * - MediaRecorder for local capture of the displayed stream
 * - Canvas-based still capture
 * - fps / per-hop latency / bitrate stats
 *
 * The `closePeerConnection` helper is intentionally kept in this file
 * so the cleanup-contract regression test (`tests/lib/video/webrtc-client.test.ts`)
 * can source-scan a single file. The per-flow modules import it from
 * the shared peer-utils module, which re-exports it from here.
 *
 * @license GPL-3.0-only
 */

export { startStream } from "./webrtc/whep-flow";
export { startStreamViaMqttSignaling } from "./webrtc/mqtt-flow";
export {
  isStreamActive,
  setVideoElement,
  stopStream,
} from "./webrtc/lifecycle";
export { captureScreenshot, startRecording, stopRecording } from "./webrtc/recording";

// Session ownership. `sessionSnapshot` is the diagnostics view of who holds
// the shared stream and how many negotiations it took.
export {
  mqttSessionKey,
  sessionSnapshot,
  whepSessionKey,
  type SessionSnapshot,
} from "./webrtc/session-state";

// Measured receiver latency: the per-hop budget and the buffer depth the
// control loop asked for.
export { currentJitterTargetMs } from "./webrtc/stats-tracker";

// Re-exports of the helpers that the cascade hook + tests pull off the
// same module today.
export {
  abortable,
  checkAborted,
  classifyError,
  detectTransportFromUrl,
  mungeForLowLatency,
} from "./webrtc-helpers";

/**
 * Tear down a PeerConnection cleanly across browsers.
 *
 * Safari leaves MediaStreamTracks in the "live" state after pc.close(),
 * which holds the camera/mic permission and forces the next stream
 * start to re-prompt the user. Stopping every receiver and sender track
 * before closing the connection releases those resources deterministically.
 *
 * Also nulls the event handlers BEFORE close() to suppress spurious
 * onconnectionstatechange("closed") callbacks during teardown that
 * re-enter store updates (w3c/webrtc-pc#1218).
 *
 * Idempotent and exception-safe — every step is individually try/caught.
 *
 * Active call sites (every PeerConnection teardown in the per-flow modules
 * routes through this helper):
 *   - whep-flow.ts: pre-start cleanup            -> closePeerConnection(existing)
 *   - whep-flow.ts: error-path teardown          -> closePeerConnection(localPc)
 *   - mqtt-flow.ts: pre-start cleanup            -> closePeerConnection(existing)
 *   - mqtt-flow.ts: error-path teardown          -> closePeerConnection(localPc)
 *   - lifecycle.ts: stopStream() teardown        -> closePeerConnection(current)
 */
export function closePeerConnection(target: RTCPeerConnection | null): void {
  if (!target) return;
  try {
    target.ontrack = null;
    target.onconnectionstatechange = null;
    target.onicecandidateerror = null;
    target.oniceconnectionstatechange = null;
    target.onicegatheringstatechange = null;
    target.onsignalingstatechange = null;
  } catch { /* noop */ }
  try {
    target.getReceivers().forEach((r) => {
      try { r.track?.stop(); } catch { /* noop */ }
    });
  } catch { /* noop */ }
  try {
    target.getSenders().forEach((s) => {
      try { s.track?.stop(); } catch { /* noop */ }
    });
  } catch { /* noop */ }
  try {
    target.close();
  } catch { /* noop */ }
}
