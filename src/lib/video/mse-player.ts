/**
 * @module MsePlayer
 * @description WebSocket to MediaSource Extensions player for cloud video streaming.
 * Connects to the configured video relay at `<relay>/ws/stream/{deviceId}` and
 * feeds fragmented MP4 data into a browser <video> element. The relay URL is
 * resolved from clientConfig with a managed default (see config/endpoints).
 *
 * The codec is read from the stream's own init segment rather than assumed;
 * see `./fmp4-codec` for why a hardcoded codec string is a silent black
 * screen rather than an error.
 *
 * @license GPL-3.0-only
 */

import { OFFICIAL_VIDEO_RELAY_URL } from "@/lib/config/endpoints";
import { codecStringFromInitSegment, mseTypeFor } from "./fmp4-codec";

/**
 * Cross-environment timer handle: `number` under the DOM lib, `Timeout`
 * under Node's, and this module is type-checked against both.
 */
type TimerHandle = ReturnType<typeof setTimeout>;

const VIDEO_RELAY_URL_DEFAULT = OFFICIAL_VIDEO_RELAY_URL;

// Reconnect delay after a transport drop or a detected stall.
const RECONNECT_DELAY_MS = 3000;
// How often the playback-stall watchdog samples currentTime.
const STALL_CHECK_INTERVAL_MS = 1000;
// currentTime frozen for at least this long while the socket is open
// means the decoder has wedged; force a fresh connection.
const PLAYBACK_STALL_TIMEOUT_MS = 5000;

/**
 * Segments allowed to pile up while the source buffer is busy.
 *
 * The queue was unbounded. A source buffer that cannot keep up — a stalled
 * decoder, a backgrounded tab, a relay burst — grew it for as long as the
 * socket stayed open, so the failure mode of a slow decoder was memory
 * growth with no ceiling. Twelve segments is a couple of seconds of media at
 * the relay's segment cadence: enough to ride out a hiccup, not enough to be
 * a leak.
 */
const MAX_QUEUED_SEGMENTS = 12;

/** Media kept behind `currentTime`, for a scrub back and for decode context. */
const RETAINED_BEHIND_S = 5;

/**
 * Drift from the live edge that triggers a seek.
 *
 * A live stream that falls behind stays behind: MSE plays what is buffered
 * from wherever `currentTime` is, and nothing pulls it forward. After a
 * stall, a queue overflow, or a backgrounded tab, the buffer's leading edge
 * runs away from the playhead and the operator watches a delayed feed with
 * no indication it is delayed.
 */
const MAX_LIVE_DRIFT_S = 2;
/** Where to land relative to the leading edge, leaving decode headroom. */
const LIVE_EDGE_MARGIN_S = 0.3;

/** Why a session failed, so a surface can say something specific. */
export type MsePlayerErrorCode =
  | "mse-unsupported"
  | "codec-unknown"
  | "codec-unsupported"
  | "source-buffer-rejected";

export interface MsePlayerError {
  code: MsePlayerErrorCode;
  message: string;
}

export interface MsePlayerOptions {
  /**
   * Called once when the session cannot proceed.
   *
   * Every one of these used to be a bare `return`, which is how the codec
   * mismatch became a silent black screen: the pane stayed connected, empty
   * and quiet.
   */
  onError?: (err: MsePlayerError) => void;
}

export class MsePlayer {
  private ws: WebSocket | null = null;
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private queue: ArrayBuffer[] = [];
  private deviceId: string = "";
  private videoRelayUrl: string = VIDEO_RELAY_URL_DEFAULT;
  private reconnectTimer: TimerHandle | null = null;
  private onError: ((err: MsePlayerError) => void) | null = null;
  /** Segments dropped to hold the queue bound, for the reconnect decision. */
  private droppedSegments = 0;

  // Playback-stall watchdog. Tracks currentTime advancement so a frozen
  // decoder (no socket close, no error event) still triggers a reconnect.
  private stallTimer: TimerHandle | null = null;
  private lastPlaybackTime = 0;
  private lastPlaybackAdvanceAt = 0;
  // Guards against overlapping reconnect attempts from multiple triggers
  // (ws close + sourceBuffer error + stall watchdog all firing at once).
  private reconnectScheduled = false;
  // Set while stop() is tearing the session down. A socket closed as part
  // of an intentional teardown must NOT schedule a reconnect, so every
  // reconnect trigger bails when this is set. Cleared by the next start().
  private tearingDown = false;

  start(
    deviceId: string,
    videoElement: HTMLVideoElement,
    videoRelayUrl?: string,
    options?: MsePlayerOptions,
  ): void {
    this.stop();
    // A fresh session — clear the teardown latch that stop() set.
    this.tearingDown = false;
    this.deviceId = deviceId;
    this.videoElement = videoElement;
    this.droppedSegments = 0;
    if (videoRelayUrl) this.videoRelayUrl = videoRelayUrl;
    if (options?.onError !== undefined) this.onError = options.onError;

    if (!("MediaSource" in window)) {
      this.fail("mse-unsupported", "MediaSource is not available in this browser");
      return;
    }

    this.mediaSource = new MediaSource();
    videoElement.src = URL.createObjectURL(this.mediaSource);

    this.mediaSource.addEventListener("sourceopen", () => {
      this.connectWebSocket();
    });

    this.startStallWatchdog();
  }

  /**
   * Poll currentTime while the socket is open. If playback has not
   * advanced within the timeout, the decoder has stalled silently (the
   * relay can keep the socket open and keep sending bytes that the
   * decoder refuses) — reconnect from scratch instead of waiting for an
   * onclose that never comes.
   */
  private startStallWatchdog(): void {
    if (this.stallTimer) return;
    this.lastPlaybackAdvanceAt = Date.now();
    this.lastPlaybackTime = this.videoElement?.currentTime ?? 0;
    this.stallTimer = setInterval(() => {
      const video = this.videoElement;
      // Only judge a stall while the socket is open. A closed socket has
      // its own reconnect path; a paused/backgrounded tab should not be
      // treated as a failure.
      if (!video || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.lastPlaybackAdvanceAt = Date.now();
        return;
      }
      if (video.paused) {
        this.lastPlaybackAdvanceAt = Date.now();
        return;
      }
      const now = Date.now();
      if (video.currentTime > this.lastPlaybackTime) {
        this.lastPlaybackTime = video.currentTime;
        this.lastPlaybackAdvanceAt = now;
        return;
      }
      if (now - this.lastPlaybackAdvanceAt > PLAYBACK_STALL_TIMEOUT_MS) {
        this.scheduleReconnect();
      }
    }, STALL_CHECK_INTERVAL_MS);
  }

  /**
   * Report a terminal session failure exactly once.
   *
   * Every one of these sites used to be a bare `return`. That is how the
   * hardcoded codec became a silent black screen rather than a message.
   */
  private fail(code: MsePlayerErrorCode, message: string): void {
    console.warn(`[mse-player] ${code}: ${message}`);
    const handler = this.onError;
    this.onError = null;
    handler?.({ code, message });
  }

  /**
   * The local recording surface used to live here — a second
   * `MediaRecorder` over `videoElement.captureStream()`, with its own
   * chunk array and its own download. It had no caller: the only
   * invocation left was `stop()` calling its own `stopRecording()`.
   * `video/webrtc/recording` is the one local-capture path, and the
   * archival path is the agent's fMP4 recorder via `./clip-export`.
   */

  stop(): void {
    // Latch teardown so the imminent socket close does not bounce back
    // through scheduleReconnect(). reconnect() re-issues start(), which
    // clears the latch for the new session.
    this.tearingDown = true;
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
    this.reconnectScheduled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Detach handlers BEFORE close() so the onclose teardown event does
      // not fire scheduleReconnect() on an intentional stop.
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
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

    this.ws.onopen = () => {
      // Fresh connection — reset the stall baseline and clear the
      // reconnect guard so a later failure can schedule again.
      this.reconnectScheduled = false;
      this.lastPlaybackAdvanceAt = Date.now();
      this.lastPlaybackTime = this.videoElement?.currentTime ?? 0;
    };

    this.ws.onmessage = (event) => {
      const data = event.data as ArrayBuffer;
      this.appendBuffer(data);
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  /**
   * Debounced reconnect. Multiple triggers (socket close, sourceBuffer
   * error/abort, playback stall) can fire near-simultaneously; the guard
   * collapses them into a single fresh connection attempt.
   */
  private scheduleReconnect(): void {
    if (this.tearingDown || this.reconnectScheduled || !this.deviceId) return;
    this.reconnectScheduled = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, RECONNECT_DELAY_MS);
  }

  /**
   * Tear the transport + MSE graph down and rebuild it. A frozen decoder
   * or an aborted sourceBuffer cannot be recovered in place, so we
   * recreate the MediaSource and re-open the socket from scratch.
   */
  private reconnect(): void {
    const video = this.videoElement;
    const deviceId = this.deviceId;
    const relayUrl = this.videoRelayUrl;
    if (!video || !deviceId) return;
    // stop() clears timers + tracks + nulls videoElement; re-issue start
    // with the captured references to rebuild the pipeline.
    this.stop();
    this.start(deviceId, video, relayUrl);
  }

  private appendBuffer(data: ArrayBuffer): void {
    if (!this.mediaSource || this.mediaSource.readyState !== "open") return;

    // The first message is the fMP4 init segment, which is where the codec
    // comes from. Passing a hardcoded string here was the silent-black-screen
    // bug: the source buffer is created against a codec the bytes are not,
    // every subsequent append is refused, and nothing says so.
    if (!this.sourceBuffer && !this.openSourceBuffer(data)) return;

    this.enqueue(data);
    this.trimBehindPlayhead();
  }

  /**
   * Create the source buffer for the codec the init segment declares.
   * Returns false when the session cannot proceed; the reason has already
   * been reported through {@link fail}.
   */
  private openSourceBuffer(initSegment: ArrayBuffer): boolean {
    const codec = codecStringFromInitSegment(initSegment);
    if (!codec) {
      this.fail(
        "codec-unknown",
        "the stream's first segment carries no codec configuration this player can read",
      );
      return false;
    }
    const mimeType = mseTypeFor(codec);
    if (
      typeof MediaSource.isTypeSupported === "function" &&
      !MediaSource.isTypeSupported(mimeType)
    ) {
      this.fail(
        "codec-unsupported",
        `this browser cannot decode ${mimeType}`,
      );
      return false;
    }
    try {
      this.sourceBuffer = this.mediaSource!.addSourceBuffer(mimeType);
    } catch (err) {
      this.fail(
        "source-buffer-rejected",
        `addSourceBuffer(${mimeType}) was refused: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
    this.sourceBuffer.addEventListener("updateend", () => {
      this.flushQueue();
      this.seekToLiveEdgeIfDrifted();
    });
    // A sourceBuffer error or abort wedges the decode graph; neither
    // is recoverable by appending more data. Reconnect from scratch.
    this.sourceBuffer.addEventListener("error", () => {
      this.scheduleReconnect();
    });
    this.sourceBuffer.addEventListener("abort", () => {
      this.scheduleReconnect();
    });
    return true;
  }

  /**
   * Append now, or queue behind the in-flight append.
   *
   * The queue is bounded and drops the OLDEST segment on overflow: this is a
   * live feed, so the newest bytes are the ones worth keeping, and an
   * unbounded queue turns a slow decoder into unbounded memory growth. A
   * drop is a discontinuity, so it also arms the live-edge seek — otherwise
   * playback sits behind the gap for the rest of the session.
   */
  private enqueue(data: ArrayBuffer): void {
    const buffer = this.sourceBuffer;
    if (!buffer) return;
    if (!buffer.updating) {
      try {
        buffer.appendBuffer(data);
        return;
      } catch {
        // Fall through to the queue: a QuotaExceededError here means the
        // buffer is full and the trim below has not run yet.
      }
    }
    this.queue.push(data);
    while (this.queue.length > MAX_QUEUED_SEGMENTS) {
      this.queue.shift();
      this.droppedSegments += 1;
    }
  }

  /**
   * Trim everything more than {@link RETAINED_BEHIND_S} behind the playhead.
   *
   * The old rule only trimmed once `currentTime > 10`, which never fires on
   * a stream that never advances — precisely the wedged case where the
   * buffer most needs reclaiming.
   */
  private trimBehindPlayhead(): void {
    const buffer = this.sourceBuffer;
    const video = this.videoElement;
    if (!buffer || !video || buffer.updating) return;
    const cutoff = video.currentTime - RETAINED_BEHIND_S;
    if (cutoff <= 0) return;
    try {
      if (buffer.buffered.length > 0 && buffer.buffered.start(0) < cutoff) {
        buffer.remove(0, cutoff);
      }
    } catch { /* ignore */ }
  }

  /**
   * Pull the playhead up to the buffer's leading edge when it has fallen
   * behind.
   *
   * MSE plays from wherever `currentTime` is and nothing pulls it forward,
   * so after a stall, a dropped segment, or a backgrounded tab the operator
   * watches a delayed feed with no sign that it is delayed — which on a
   * piloting surface is the whole problem.
   */
  private seekToLiveEdgeIfDrifted(): void {
    const buffer = this.sourceBuffer;
    const video = this.videoElement;
    if (!buffer || !video) return;
    try {
      const ranges = buffer.buffered;
      if (ranges.length === 0) return;
      const edge = ranges.end(ranges.length - 1);
      if (edge - video.currentTime <= MAX_LIVE_DRIFT_S) return;
      video.currentTime = Math.max(edge - LIVE_EDGE_MARGIN_S, 0);
      this.lastPlaybackTime = video.currentTime;
      this.lastPlaybackAdvanceAt = Date.now();
    } catch { /* ignore */ }
  }

  private flushQueue(): void {
    const buffer = this.sourceBuffer;
    if (!buffer || buffer.updating || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (next) {
      try {
        buffer.appendBuffer(next);
      } catch { /* ignore */ }
    }
  }
}
