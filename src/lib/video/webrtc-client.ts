/**
 * WebRTC video stream client for Altnautica Command GCS.
 *
 * Connects to a mediamtx server via WHEP (WebRTC-HTTP Egress Protocol)
 * for low-latency H.264/H.265 video. Provides:
 * - Stream start/stop
 * - MediaRecorder for local recording (WebM/VP8)
 * - Canvas-based screenshot capture
 * - FPS/latency stats
 *
 * @module video/webrtc-client
 */

import { useVideoStore } from "@/stores/video-store";

// DEC-108 Phase E: pc/mediaRecorder/statsInterval/videoElement are session-
// scoped and get re-initialized cleanly on every startStream call. The
// per-poll DELTA STATE (lastFramesDecoded, lastStatsTime, etc.) used to
// live in module-level globals here too, but Turbopack HMR re-evaluated
// the module on every unrelated file change and reset them to 0, breaking
// the FPS counter. That state now lives in useVideoStore._pollState which
// is HMR-safe (Zustand stores live on globalThis).
let pc: RTCPeerConnection | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let statsInterval: ReturnType<typeof setInterval> | null = null;
let videoElement: HTMLVideoElement | null = null;

// DEC-108 Phase B0: MQTT signaling broker for P2P WebRTC across WAN.
// SDP offer/answer flows over MQTT topics; media flows direct peer-to-peer
// via STUN-punched ICE candidates after the handshake.
const MQTT_SIGNALING_WS_URL = "wss://mqtt.altnautica.com/mqtt";
const MQTT_SIGNALING_TIMEOUT_MS = 10000;
// Public STUN servers for ICE candidate gathering on cross-network paths.
const CROSS_NETWORK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** DEC-108 Phase D: classify a WHEP URL as LAN-direct or cloud relay. */
function detectTransportFromUrl(url: string): "lan-whep" | "cloud-whep" {
  try {
    const u = new URL(url);
    const host = u.hostname;
    // Loopback or RFC1918 private addresses → LAN direct
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return "lan-whep";
    }
    return "cloud-whep";
  } catch {
    return "lan-whep";
  }
}

/**
 * Start a WebRTC stream from a WHEP endpoint.
 * @param whepUrl — Full WHEP URL, e.g. `http://192.168.1.50:8889/stream/whep`
 * @returns The MediaStream to attach to a <video> element.
 */
export async function startStream(whepUrl: string): Promise<MediaStream> {
  const store = useVideoStore.getState();

  // Clean up any stale connection before starting fresh
  if (pc) {
    try { pc.close(); } catch { /* noop */ }
    pc = null;
    stopStatsPolling();
  }

  pc = new RTCPeerConnection({
    iceServers: [], // Local network — no STUN/TURN needed
  });

  // Monitor connection state — detect silent disconnections
  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === "disconnected" || state === "failed" || state === "closed") {
      console.warn("[webrtc-client] Connection state:", state);
      const s = useVideoStore.getState();
      s.setStreaming(false);
      s.updateStats(0, 0);
      stopStatsPolling();
      // Don't close pc here — let stopStream() handle cleanup
      // This just updates the UI state so it shows NO SIGNAL
    }
  };

  // Receive-only transceiver
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete (or timeout)
  await new Promise<void>((resolve) => {
    if (pc!.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const check = () => {
      if (pc?.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc!.addEventListener("icegatheringstatechange", check);
    // Timeout after 3 seconds
    setTimeout(resolve, 3000);
  });

  // Send offer to WHEP endpoint
  const response = await fetch(whepUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription!.sdp,
  });

  if (!response.ok) {
    pc.close();
    pc = null;
    throw new Error(
      `WHEP request failed: ${response.status} ${response.statusText}`
    );
  }

  const answerSdp = await response.text();

  // Set ontrack BEFORE setRemoteDescription to avoid race condition
  // (track events can fire during or immediately after setRemoteDescription)
  const trackPromise = new Promise<MediaStream>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("No video track received within 10 seconds"));
    }, 10000);

    pc!.ontrack = (event) => {
      if (event.streams[0]) {
        clearTimeout(timeout);
        resolve(event.streams[0]);
      }
    };
  });

  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  const stream = await trackPromise;

  store.setStreamUrl(whepUrl);
  store.setStreaming(true);
  // DEC-108 Phase D: classify and publish the active transport so the UI
  // can show "LAN DIRECT" / "CLOUD WHEP" badges.
  store.setTransport(detectTransportFromUrl(whepUrl));

  // Start stats polling
  startStatsPolling();

  return stream;
}

/**
 * DEC-108 Phase B0: Start a WebRTC stream via MQTT-relayed SDP signaling.
 *
 * Used when the browser cannot reach the agent's local WHEP endpoint
 * directly (cross-network case — cellular phone, different LAN). The SDP
 * offer is published to `ados/{deviceId}/webrtc/offer`; the agent's
 * WebrtcSignalingRelay forwards it to local mediamtx and publishes the
 * answer to `ados/{deviceId}/webrtc/answer`. Media flows direct
 * peer-to-peer via STUN-punched ICE candidates after the handshake.
 *
 * @param deviceId — Cloud device ID of the paired agent.
 * @returns The MediaStream to attach to a <video> element.
 */
export async function startStreamViaMqttSignaling(
  deviceId: string,
): Promise<MediaStream> {
  const store = useVideoStore.getState();

  // Clean up any stale connection before starting fresh
  if (pc) {
    try { pc.close(); } catch { /* noop */ }
    pc = null;
    stopStatsPolling();
  }

  pc = new RTCPeerConnection({ iceServers: CROSS_NETWORK_ICE_SERVERS });

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === "disconnected" || state === "failed" || state === "closed") {
      console.warn("[webrtc-client] P2P MQTT connection state:", state);
      const s = useVideoStore.getState();
      s.setStreaming(false);
      s.updateStats(0, 0);
      stopStatsPolling();
    }
  };

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering (critical for cross-network — offer must carry
  // all srflx candidates STUN discovered). 5s ceiling.
  await new Promise<void>((resolve) => {
    if (pc!.iceGatheringState === "complete") { resolve(); return; }
    const check = () => {
      if (pc?.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc!.addEventListener("icegatheringstatechange", check);
    setTimeout(resolve, 5000);
  });

  // Connect a one-shot mqtt.js client for the SDP handshake.
  const mqttModule = await import("mqtt");
  const connectFn = mqttModule.connect
    ?? (mqttModule.default as { connect?: typeof mqttModule.connect })?.connect
    ?? mqttModule.default;
  if (typeof connectFn !== "function") {
    pc.close(); pc = null;
    throw new Error("mqtt.connect not found in module");
  }

  const topicOffer = `ados/${deviceId}/webrtc/offer`;
  const topicAnswer = `ados/${deviceId}/webrtc/answer`;

  type MqttClient = {
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    subscribe: (topic: string, cb?: (err: Error | null) => void) => void;
    publish: (topic: string, payload: string | Buffer, opts?: { qos?: 0 | 1 | 2 }) => void;
    end: (force?: boolean) => void;
  };

  const mqttClient = (connectFn as typeof mqttModule.connect)(
    MQTT_SIGNALING_WS_URL,
    { protocolVersion: 5, clean: true, reconnectPeriod: 0 },
  ) as unknown as MqttClient;

  // Race: answer arrival vs overall timeout.
  const answerSdp = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      mqttClient.end(true);
      reject(new Error("MQTT signaling timeout — no answer within 10s"));
    }, MQTT_SIGNALING_TIMEOUT_MS);

    mqttClient.on("error", (err: unknown) => {
      clearTimeout(timer);
      mqttClient.end(true);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    mqttClient.on("message", (topic: unknown, payload: unknown) => {
      if (topic !== topicAnswer) return;
      clearTimeout(timer);
      // payload is Buffer in mqtt.js
      const sdp = (payload as Buffer).toString("utf-8");
      mqttClient.end(true);
      resolve(sdp);
    });

    mqttClient.on("connect", () => {
      mqttClient.subscribe(topicAnswer, (err: Error | null) => {
        if (err) {
          clearTimeout(timer);
          mqttClient.end(true);
          reject(err);
          return;
        }
        // Subscribed → publish offer (qos=1 so paho-side queues if busy)
        mqttClient.publish(topicOffer, pc!.localDescription!.sdp, { qos: 1 });
      });
    });
  });

  // Set ontrack BEFORE setRemoteDescription to avoid race
  const trackPromise = new Promise<MediaStream>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("No video track received within 10 seconds"));
    }, 10000);
    pc!.ontrack = (event) => {
      if (event.streams[0]) {
        clearTimeout(timeout);
        resolve(event.streams[0]);
      }
    };
  });

  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  const stream = await trackPromise;

  store.setStreamUrl(`mqtt://${deviceId}/webrtc`);
  store.setStreaming(true);
  store.setTransport("p2p-mqtt");
  startStatsPolling();

  return stream;
}

/** Stop the active WebRTC stream. */
export async function stopStream(): Promise<void> {
  const store = useVideoStore.getState();

  if (mediaRecorder?.state === "recording") {
    stopRecording();
  }

  stopStatsPolling();

  if (pc) {
    pc.close();
    pc = null;
  }

  store.setStreaming(false);
  store.setStreamUrl(null);
  store.updateStats(0, 0);
  store.setTransport("unknown");
  store.setVideoMetrics({ codec: "", bitrateKbps: 0, packetsLost: 0, jitterMs: 0 });
}

/** Bind a video element for screenshot/recording reference. */
export function setVideoElement(el: HTMLVideoElement | null): void {
  videoElement = el;

  if (el) {
    // Track resolution changes
    el.addEventListener("loadedmetadata", () => {
      useVideoStore
        .getState()
        .setResolution(`${el.videoWidth}x${el.videoHeight}`);
    });
  }
}

/** Start recording the video stream to a local WebM file. */
export function startRecording(): void {
  if (!videoElement?.srcObject) {
    throw new Error("No active stream to record");
  }

  const store = useVideoStore.getState();
  recordedChunks = [];

  const stream = videoElement.srcObject as MediaStream;
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp8,opus",
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.start(1000); // 1-second chunks
  store.setRecording(true);
}

/** Stop recording and download the file. */
export function stopRecording(): Blob | null {
  const store = useVideoStore.getState();

  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    store.setRecording(false);
    return null;
  }

  mediaRecorder.stop();
  store.setRecording(false);

  const blob = new Blob(recordedChunks, { type: "video/webm" });
  recordedChunks = [];
  mediaRecorder = null;

  // Auto-download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `altnautica-recording-${Date.now()}.webm`;
  a.click();
  URL.revokeObjectURL(url);

  return blob;
}

/** Capture a screenshot from the current video frame. */
export function captureScreenshot(): string | null {
  if (!videoElement || videoElement.readyState < 2) return null;

  const canvas = document.createElement("canvas");
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(videoElement, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");

  // Auto-download
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `altnautica-screenshot-${Date.now()}.png`;
  a.click();

  return dataUrl;
}

/** Poll WebRTC stats for FPS and latency.
 *
 * DEC-108: the previous implementation relied on `framesPerSecond` and
 * `jitterBufferDelay` from `inbound-rtp` stats. `framesPerSecond` is not
 * populated by all browsers (Safari often omits it on first poll cycles),
 * and `jitterBufferDelay/jitterBufferEmittedCount` measures only the
 * decoder buffer wait — it does NOT include the network round-trip.
 *
 * The corrected implementation:
 *   - Computes fps from `framesDecoded` delta over the polling interval,
 *     so it works on every browser even when framesPerSecond is undefined.
 *   - Pulls round-trip time from `candidate-pair.currentRoundTripTime` of
 *     the nominated/succeeded candidate pair, which is the true L4 latency
 *     (browser ↔ mediamtx network RTT). Adds the jitter buffer delay (L5)
 *     on top to give glass-to-decoded total.
 */
function startStatsPolling(): void {
  if (statsInterval) return;

  // DEC-108 Phase E: reset polling state in the HMR-safe Zustand store
  useVideoStore.getState().resetPollState();
  useVideoStore.getState().setPollState({ lastFrameTime: Date.now() });

  statsInterval = setInterval(async () => {
    if (!pc) return;

    const stats = await pc.getStats();
    const store = useVideoStore.getState();
    // DEC-108 Phase E: read persistent polling state from store
    const ps = store._pollState;
    const lastFramesDecoded = ps.lastFramesDecoded;
    const lastStatsTime = ps.lastStatsTime;
    const lastBytesReceived = ps.lastBytesReceived;
    const lastJitterDelay = ps.lastJitterDelay;
    const lastJitterEmitted = ps.lastJitterEmitted;

    // Build a lookup for codec stats reports (keyed by id).
    // RTCRtpCodecStats isn't always declared in the lib.dom typings, so use
    // a structural type for the fields we read.
    type CodecStatsLite = { id: string; type: string; mimeType?: string };
    const codecReports = new Map<string, CodecStatsLite>();
    stats.forEach((report) => {
      if (report.type === "codec") {
        codecReports.set(report.id, report as unknown as CodecStatsLite);
      }
    });

    let computedFps = 0;
    let inboundFound = false;
    let jitterMs = 0;
    let rttMs = 0;
    let framesDecoded = 0;
    let codecName = "";
    let bitrateKbps = 0;
    let packetsLost = 0;
    let inboundJitterRtpMs = 0;
    let bytesReceived = 0;

    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && report.kind === "video") {
        inboundFound = true;

        type ExtendedInbound = RTCInboundRtpStreamStats & {
          framesPerSecond?: number;
          framesDecoded?: number;
          jitterBufferDelay?: number;
          jitterBufferEmittedCount?: number;
          codecId?: string;
          bytesReceived?: number;
          packetsLost?: number;
          jitter?: number;
        };
        const r = report as ExtendedInbound;

        // Prefer the browser-reported framesPerSecond, fall back to derived
        const reportedFps = r.framesPerSecond;
        const decoded = r.framesDecoded ?? 0;
        framesDecoded = decoded;
        const now = Date.now();

        if (reportedFps !== undefined && reportedFps > 0) {
          computedFps = Math.round(reportedFps);
        } else if (lastStatsTime > 0 && decoded > lastFramesDecoded) {
          const elapsedSec = (now - lastStatsTime) / 1000;
          if (elapsedSec > 0) {
            computedFps = Math.round((decoded - lastFramesDecoded) / elapsedSec);
          }
        }

        // Decoder jitter buffer (L5) — DEC-108 Phase D follow-up: use the
        // delta over the last polling window instead of the cumulative
        // average. The cumulative ratio gets pinned to whatever the buffer
        // looked like during the connection ramp-up, even if the stream is
        // now smooth.
        const delay = r.jitterBufferDelay ?? 0;
        const emitted = r.jitterBufferEmittedCount ?? 0;
        if (emitted > lastJitterEmitted && lastJitterEmitted > 0) {
          const deltaDelay = delay - lastJitterDelay;
          const deltaEmitted = emitted - lastJitterEmitted;
          if (deltaEmitted > 0) {
            jitterMs = Math.round((deltaDelay / deltaEmitted) * 1000);
          }
        } else if (emitted > 0 && lastJitterEmitted === 0) {
          // First sample — use cumulative as best available
          jitterMs = Math.round((delay / emitted) * 1000);
        }
        // Persist for next window — local mutation only; we batch the
        // store write at the bottom of this poll cycle
        ps.lastJitterDelay = delay;
        ps.lastJitterEmitted = emitted;

        // DEC-108 Phase D: codec / bitrate / packet loss / RTP jitter
        if (r.codecId && codecReports.has(r.codecId)) {
          const codec = codecReports.get(r.codecId)!;
          // mimeType looks like "video/H264" or "video/VP8"
          const mime = codec.mimeType || "";
          codecName = mime.includes("/") ? mime.split("/")[1] : mime;
        }
        bytesReceived = r.bytesReceived ?? 0;
        packetsLost = r.packetsLost ?? 0;
        // r.jitter is in seconds (per spec)
        inboundJitterRtpMs = Math.round((r.jitter ?? 0) * 1000);
      }

      if (
        report.type === "candidate-pair" &&
        (report as RTCIceCandidatePairStats).state === "succeeded" &&
        (report as RTCIceCandidatePairStats).nominated
      ) {
        // Network round-trip (L4) — browser ↔ mediamtx
        const rttSec = (report as RTCIceCandidatePairStats).currentRoundTripTime ?? 0;
        rttMs = Math.round(rttSec * 1000);
      }
    });

    if (inboundFound) {
      // Total displayed latency = network RTT + jitter buffer delay
      // (sensor capture + encoder are agent-side, not measurable from browser)
      const totalLatencyMs = rttMs + jitterMs;
      store.updateStats(computedFps, totalLatencyMs);

      // DEC-108 Phase D: bitrate from byte delta over the polling interval
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

      // DEC-108 Phase E: persist polling state to the Zustand store. This
      // single setPollState call replaces all 5 module-global writes — the
      // store is HMR-safe so the next poll cycle (even after a Turbopack
      // reload of this module) will read the correct previous values.
      store.setPollState({
        lastFramesDecoded: framesDecoded,
        lastBytesReceived: bytesReceived,
        lastStatsTime: Date.now(),
        lastJitterDelay: ps.lastJitterDelay,
        lastJitterEmitted: ps.lastJitterEmitted,
        lastFrameTime: computedFps > 0 ? Date.now() : ps.lastFrameTime,
      });

      // DEC-108 RCA: previously this branch fired a "frame timeout" disconnect
      // when computedFps stayed at 0 for >20s. The pattern was wrong:
      //   - Module-level state (lastFramesDecoded, lastStatsTime) gets reset
      //     by Turbopack HMR every time ANY file in the project changes
      //   - The reset makes computedFps stuck at 0 even when frames are flowing
      //   - The timeout fires falsely → setStreaming(false) → VideoFeedCard
      //     auto-reconnect → new peer connection → mediamtx renegotiates →
      //     state resets again → loop
      // The user perceived this as "intermittent connect/disconnect".
      //
      // The native pc.onconnectionstatechange handler (line 44-55) ALREADY
      // detects real disconnects (state transitions to "disconnected"/"failed"/
      // "closed"). We don't need a custom frame-arrival timer on top of that.
      // Removing the custom timeout. If frames stop but the WebRTC connection
      // is still alive, the user sees a frozen frame, which is the correct
      // behavior — the user can manually retry via the reconnect button.
      // (lastFrameTime is now persisted via setPollState in the batched
      // store update above.)
    }
  }, 1000);
}

function stopStatsPolling(): void {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

/** Check if a stream is currently active. */
export function isStreamActive(): boolean {
  return pc !== null && pc.connectionState === "connected";
}
