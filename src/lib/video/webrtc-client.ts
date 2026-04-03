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

let pc: RTCPeerConnection | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let statsInterval: ReturnType<typeof setInterval> | null = null;
let videoElement: HTMLVideoElement | null = null;

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

  // Start stats polling
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

/** Poll WebRTC stats for FPS and latency. */
function startStatsPolling(): void {
  if (statsInterval) return;

  statsInterval = setInterval(async () => {
    if (!pc) return;

    const stats = await pc.getStats();
    const store = useVideoStore.getState();

    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && report.kind === "video") {
        const fps = report.framesPerSecond ?? 0;
        // jitterBufferDelay / jitterBufferEmittedCount ~ latency
        const delay = report.jitterBufferDelay ?? 0;
        const emitted = report.jitterBufferEmittedCount ?? 1;
        const latencyMs =
          emitted > 0 ? Math.round((delay / emitted) * 1000) : 0;
        store.updateStats(fps, latencyMs);
      }
    });
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
