/**
 * @module MsePlayer
 * @description WebSocket to MediaSource Extensions player for cloud video streaming.
 * Connects to the video relay at wss://video.altnautica.com/ws/stream/{deviceId}
 * and feeds fragmented MP4 data into a browser <video> element.
 * @license GPL-3.0-only
 */

// captureStream() is not in standard TypeScript DOM types but is widely supported
declare global {
  interface HTMLVideoElement {
    captureStream(): MediaStream;
  }
}

const VIDEO_RELAY_URL_DEFAULT = "wss://video.altnautica.com";

export class MsePlayer {
  private ws: WebSocket | null = null;
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private queue: ArrayBuffer[] = [];
  private deviceId: string = "";
  private videoRelayUrl: string = VIDEO_RELAY_URL_DEFAULT;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Recording state
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  start(deviceId: string, videoElement: HTMLVideoElement, videoRelayUrl?: string): void {
    this.stop();
    this.deviceId = deviceId;
    this.videoElement = videoElement;
    if (videoRelayUrl) this.videoRelayUrl = videoRelayUrl;

    if (!("MediaSource" in window)) {
      console.warn("MSE not supported in this browser");
      return;
    }

    this.mediaSource = new MediaSource();
    videoElement.src = URL.createObjectURL(this.mediaSource);

    this.mediaSource.addEventListener("sourceopen", () => {
      this.connectWebSocket();
    });
  }

  /** Start recording the video stream to a .webm file. */
  startRecording(): boolean {
    if (!this.videoElement || this.recorder) return false;
    try {
      const stream = this.videoElement.captureStream();
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      this.recorder = new MediaRecorder(stream, { mimeType });
      this.recordedChunks = [];
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.recorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.href = url;
        a.download = `altnautica-recording-${ts}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        this.recordedChunks = [];
        this.recorder = null;
      };
      this.recorder.start(1000);
      return true;
    } catch {
      return false;
    }
  }

  /** Stop recording and trigger download. */
  stopRecording(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
  }

  /** Whether recording is currently active. */
  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === "recording";
  }

  stop(): void {
    this.stopRecording();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.mediaSource && this.mediaSource.readyState === "open") {
      try {
        this.mediaSource.endOfStream();
      } catch { /* ignore */ }
    }
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.queue = [];
    if (this.videoElement) {
      if (this.videoElement.src) {
        URL.revokeObjectURL(this.videoElement.src);
      }
      this.videoElement.src = "";
      this.videoElement = null;
    }
  }

  private connectWebSocket(): void {
    const url = `${this.videoRelayUrl}/ws/stream/${this.deviceId}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onmessage = (event) => {
      const data = event.data as ArrayBuffer;
      this.appendBuffer(data);
    };

    this.ws.onclose = () => {
      // Auto-reconnect after 3s
      this.reconnectTimer = setTimeout(() => {
        if (this.mediaSource && this.deviceId) {
          this.connectWebSocket();
        }
      }, 3000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private appendBuffer(data: ArrayBuffer): void {
    if (!this.mediaSource || this.mediaSource.readyState !== "open") return;

    // Initialize source buffer on first data (fMP4 init segment)
    if (!this.sourceBuffer) {
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.640029"');
        this.sourceBuffer.addEventListener("updateend", () => {
          this.flushQueue();
        });
      } catch {
        return;
      }
    }

    if (this.sourceBuffer.updating) {
      this.queue.push(data);
    } else {
      try {
        this.sourceBuffer.appendBuffer(data);
      } catch {
        this.queue.push(data);
      }
    }

    // Keep buffer trim -- remove data older than 10s
    if (this.videoElement && this.sourceBuffer && !this.sourceBuffer.updating) {
      const currentTime = this.videoElement.currentTime;
      if (currentTime > 10) {
        try {
          this.sourceBuffer.remove(0, currentTime - 5);
        } catch { /* ignore */ }
      }
    }
  }

  private flushQueue(): void {
    if (!this.sourceBuffer || this.sourceBuffer.updating || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (next) {
      try {
        this.sourceBuffer.appendBuffer(next);
      } catch { /* ignore */ }
    }
  }
}
