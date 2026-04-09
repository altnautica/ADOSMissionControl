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

import { useVideoStore, type TransportErrorCode, type TransportAttemptStage, type VideoTransport } from "@/stores/video-store";

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
// DEC-107 Phase H: timeouts bumped — slow cellular initial signaling needs
// more headroom. Each value is the per-stage ceiling.
const MQTT_CONNECT_TIMEOUT_MS = 8000;
const MQTT_ANSWER_TIMEOUT_MS = 12000;
const ICE_GATHER_TIMEOUT_MS = 8000;
const ONTRACK_TIMEOUT_MS = 8000;
// Part I P2-18: LAN paths get tighter timeouts since loopback / RFC1918
// either responds within a couple seconds or won't respond at all.
const LAN_ICE_GATHER_TIMEOUT_MS = 3000;
const LAN_ONTRACK_TIMEOUT_MS = 8000;
// DEC-107 Phase H: expanded STUN server list for better ICE candidate diversity.
// More candidates = higher chance of finding a working pair on cellular and
// corporate networks. Cloudflare anycast STUN reaches many regions; Twilio
// adds an independent network path; Google stun2 is a third Google POP.
const CROSS_NETWORK_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

// DEC-107 Phase H: shared helpers for the cascade hook to thread per-mode
// health updates from inside the WebRTC client.
function reportHealth(
  transport: VideoTransport,
  patch: { state?: "testing" | "ok" | "failed"; stage?: TransportAttemptStage; code?: TransportErrorCode; error?: string; connectMs?: number },
): void {
  useVideoStore.getState().setTransportHealth(transport, {
    state: patch.state,
    lastAttemptStage: patch.stage ?? null,
    lastErrorCode: patch.code ?? null,
    lastError: patch.error ?? null,
    connectMs: patch.connectMs ?? null,
  });
}

// Part I P0-3: helper for AbortSignal-driven cancellation. Throws an
// AbortError that classifyError catches and reports as { code: "aborted" }.
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

// Part I P0-3: race a promise against an AbortSignal. The promise itself
// can't be aborted (no AbortablePromise in JS) but we can reject early when
// the signal fires.
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

// DEC-107 Phase H: classify a thrown error into a TransportErrorCode based
// on the message. Lets the dropdown tooltip surface "ICE timeout" instead of
// raw stack traces.
//
// Part I P1-8: added cascade-timeout and abort patterns. Order matters —
// most specific patterns first.
function classifyError(err: unknown): { code: TransportErrorCode; message: string } {
  // Native AbortError thrown by our checkAborted() helper or fetch()
  if (err instanceof DOMException && err.name === "AbortError") {
    return { code: "aborted", message: "Cancelled" };
  }
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("aborted") || lower.includes("cancelled")) {
    return { code: "aborted", message };
  }
  // Cascade-level timeouts come from withTimeout in the cascade hook and
  // look like "LAN Direct timeout after 4000ms" or "P2P MQTT timeout after 14000ms"
  if (lower.match(/^(lan direct|p2p mqtt|cloud whep|cloud mse) timeout/)) {
    return { code: "cascade-timeout", message };
  }
  if (lower.includes("ice gather") || lower.includes("ice gathering")) {
    return { code: "ice-gather-timeout", message };
  }
  if (lower.includes("disconnect") && lower.includes("ice")) {
    return { code: "ice-disconnect", message };
  }
  if (lower.includes("mqtt") && lower.includes("timeout")) {
    return { code: "mqtt-answer-timeout", message };
  }
  if (lower.includes("mqtt broker connect")) {
    return { code: "mqtt-connect-timeout", message };
  }
  if (lower.includes("subscribe")) {
    return { code: "mqtt-subscribe-failed", message };
  }
  if (lower.includes("ontrack") || lower.includes("video track")) {
    return { code: "ontrack-timeout", message };
  }
  // WHEP HTTP status — check status code in message
  if (/4\d\d/.test(message) && lower.includes("whep")) {
    return { code: "whep-4xx", message };
  }
  if (/5\d\d/.test(message) && lower.includes("whep")) {
    return { code: "whep-5xx", message };
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return { code: "whep-network", message };
  }
  return { code: "other", message };
}

// DEC-107 Phase H: ICE restart cooldown — only attempt once per 5 seconds to
// avoid thrash on flapping networks.
//
// Part I P0-5: takes a targetPc parameter so handlers can pass their own
// captured pc reference. Refuses to restart if targetPc isn't the current
// active pc (cascade may have moved on to a different transport).
let lastIceRestartAt = 0;
function tryIceRestart(targetPc: RTCPeerConnection): void {
  if (targetPc !== pc) return; // a newer pc has taken over
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
  const startedAt = Date.now();
  const transport: VideoTransport = detectTransportFromUrl(whepUrl);

  // DEC-107 Phase H: report testing state for the cascade UX
  reportHealth(transport, { state: "testing", stage: "starting" });

  // Clean up any stale connection before starting fresh
  if (pc) {
    try { pc.close(); } catch { /* noop */ }
    pc = null;
    stopStatsPolling();
  }

  try {
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
  store.setTransport(transport);
  // DEC-107 Phase H: report success with measured latency
  reportHealth(transport, {
    state: "ok",
    stage: "connected",
    latencyMs: Date.now() - startedAt,
  });

  // Start stats polling
  startStatsPolling();

  return stream;
  } catch (err) {
    if (pc) {
      try { pc.close(); } catch { /* noop */ }
      pc = null;
    }
    const { code, message } = classifyError(err);
    reportHealth(transport, { state: "failed", code, error: message });
    throw err;
  }
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
  const startedAt = Date.now();

  // DEC-107 Phase H: report testing state immediately so the UX dropdown
  // shows the live attempt.
  reportHealth("p2p-mqtt", { state: "testing", stage: "starting" });

  // Clean up any stale connection before starting fresh.
  if (pc) {
    try { pc.close(); } catch { /* noop */ }
    pc = null;
    stopStatsPolling();
  }

  // mqtt.js client lives outside the inner Promise so the outer try/finally
  // guarantees cleanup on every code path (success, timeout, error).
  type MqttClient = {
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    subscribe: (topic: string, cb?: (err: Error | null) => void) => void;
    publish: (topic: string, payload: string | Buffer, opts?: { qos?: 0 | 1 | 2 }) => void;
    end: (force?: boolean) => void;
  };
  let mqttClient: MqttClient | null = null;

  try {
    pc = new RTCPeerConnection({
      iceServers: CROSS_NETWORK_ICE_SERVERS,
      iceTransportPolicy: "all",
    });

    // DEC-107 Phase H: ICE restart on transient disconnect. The browser
    // detects 'disconnected' state when ICE keepalives stop arriving but
    // before declaring the connection 'failed'. restartIce() can recover
    // a paused connection without a full session teardown.
    pc.onconnectionstatechange = () => {
      const state = pc?.connectionState;
      if (state === "disconnected") {
        console.warn("[webrtc-client] P2P MQTT disconnected — attempting ICE restart");
        tryIceRestart();
      } else if (state === "failed" || state === "closed") {
        console.warn("[webrtc-client] P2P MQTT terminal state:", state);
        const s = useVideoStore.getState();
        s.setStreaming(false);
        s.updateStats(0, 0);
        stopStatsPolling();
        reportHealth("p2p-mqtt", {
          state: "failed",
          stage: "connected",
          code: "ice-disconnect",
          error: `Connection ${state}`,
        });
      }
    };

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // === Stage: ICE gathering ===
    reportHealth("p2p-mqtt", { state: "testing", stage: "ice-gathering" });
    await new Promise<void>((resolve) => {
      if (pc!.iceGatheringState === "complete") { resolve(); return; }
      const check = () => {
        if (pc?.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      pc!.addEventListener("icegatheringstatechange", check);
      // DEC-107 Phase H: 8s ceiling (was 5s). Slow cellular needs more time.
      setTimeout(resolve, ICE_GATHER_TIMEOUT_MS);
    });

    // === Stage: SDP exchange via MQTT ===
    reportHealth("p2p-mqtt", { state: "testing", stage: "sdp-exchange" });
    const mqttModule = await import("mqtt");
    const connectFn = mqttModule.connect
      ?? (mqttModule.default as { connect?: typeof mqttModule.connect })?.connect
      ?? mqttModule.default;
    if (typeof connectFn !== "function") {
      throw new Error("mqtt.connect not found in module");
    }

    const topicOffer = `ados/${deviceId}/webrtc/offer`;
    const topicAnswer = `ados/${deviceId}/webrtc/answer`;

    mqttClient = (connectFn as typeof mqttModule.connect)(
      MQTT_SIGNALING_WS_URL,
      { protocolVersion: 5, clean: true, reconnectPeriod: 0 },
    ) as unknown as MqttClient;

    // Wait for broker connect (separate timeout from answer wait so we can
    // distinguish "broker unreachable" from "agent unreachable").
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("MQTT broker connect timeout")),
        MQTT_CONNECT_TIMEOUT_MS,
      );
      mqttClient!.on("connect", () => { clearTimeout(t); resolve(); });
      mqttClient!.on("error", (err: unknown) => {
        clearTimeout(t);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    // Subscribe + publish + wait for answer (single composite timeout).
    const answerSdp = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`MQTT signaling timeout — no answer within ${MQTT_ANSWER_TIMEOUT_MS / 1000}s`)),
        MQTT_ANSWER_TIMEOUT_MS,
      );

      mqttClient!.on("error", (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      mqttClient!.on("message", (topic: unknown, payload: unknown) => {
        if (topic !== topicAnswer) return;
        clearTimeout(timer);
        const sdp = (payload as Buffer).toString("utf-8");
        resolve(sdp);
      });

      mqttClient!.subscribe(topicAnswer, (err: Error | null) => {
        if (err) {
          clearTimeout(timer);
          reject(new Error(`MQTT subscribe failed: ${err.message}`));
          return;
        }
        // Subscribed → publish offer
        mqttClient!.publish(topicOffer, pc!.localDescription!.sdp, { qos: 1 });
      });
    });

    // === Stage: ontrack wait ===
    reportHealth("p2p-mqtt", { state: "testing", stage: "ontrack-wait" });
    const trackPromise = new Promise<MediaStream>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`No video track received within ${ONTRACK_TIMEOUT_MS / 1000} seconds`)),
        ONTRACK_TIMEOUT_MS,
      );
      pc!.ontrack = (event) => {
        if (event.streams[0]) {
          clearTimeout(timeout);
          resolve(event.streams[0]);
        }
      };
    });

    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    const stream = await trackPromise;

    // === Stage: connected ===
    const elapsedMs = Date.now() - startedAt;
    store.setStreamUrl(`mqtt://${deviceId}/webrtc`);
    store.setStreaming(true);
    store.setTransport("p2p-mqtt");
    reportHealth("p2p-mqtt", { state: "ok", stage: "connected", latencyMs: elapsedMs });
    startStatsPolling();

    return stream;
  } catch (err) {
    // Tear down peer connection on any failure
    if (pc) {
      try { pc.close(); } catch { /* noop */ }
      pc = null;
    }
    const { code, message } = classifyError(err);
    reportHealth("p2p-mqtt", { state: "failed", code, error: message });
    throw err;
  } finally {
    // DEC-107 Phase H: guaranteed mqtt.js client cleanup. Earlier the
    // .end(true) call lived inside the inner Promise handlers — if any
    // unrelated error path threw before reaching them, the broker
    // connection leaked.
    if (mqttClient) {
      try { mqttClient.end(true); } catch { /* noop */ }
    }
  }
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
