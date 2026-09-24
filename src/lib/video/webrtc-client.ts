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
//
// `detectTransportFromUrl` is gone: it classified a WHEP URL as `lan-whep` or
// `cloud-whep`, had no caller but this re-export, and `cloud-whep` is no
// longer a transport. The active transport comes from the cascade mode that
// dialled, which is authoritative — the hostname heuristic mis-classified a
// tunnelled LAN URL anyway.
export {
  abortable,
  checkAborted,
  classifyError,
  mungeForLowLatency,
} from "./webrtc-helpers";

export { closePeerConnection, onPeerConnectionClose } from "./webrtc/teardown";
