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

// Fixed delay before every reconnect: after a transport drop, a detected
// stall, a refused or failed token mint, or a session failure. The session
// never gives up on its own; only `stop()` ends it.
const RECONNECT_DELAY_MS = 3000;
/**
 * A dial (token mint plus WebSocket handshake) that has not opened within
 * this long is abandoned and retried. A socket hung in CONNECTING raises no
 * close and the stall watchdog only judges an open socket, so without this
 * deadline the tile would wait on it indefinitely.
 */
const CONNECT_DEADLINE_MS = 5000;
/**
 * Consecutive sockets that closed before opening which are retried silently.
 * The relay answers a refused token with a bare HTTP 401 on the upgrade,
 * which a browser surfaces only as a close before `open`. The first such
 * close is usually an expired token and the next dial mints a fresh one;
 * from the second in a row on, the refusal is reported while retrying
 * continues on the same fixed cadence.
 */
const SILENT_PRE_OPEN_RETRIES = 1;
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
 * Drift from the live edge that triggers a seek, and where to land.
 *
 * 0.6 s / 0.15 s, not 2 s / 0.3 s. This is a piloting feed: allowing two
 * seconds of drift before chasing, then landing 300 ms behind the edge, is up
 * to 2.3 s of delay the operator has no indication of. The tighter pair still
 * leaves ~5 frames of decode headroom at 30 fps.
 */
const MAX_LIVE_DRIFT_S = 0.6;
/** Where to land relative to the leading edge, leaving decode headroom. */
const LIVE_EDGE_MARGIN_S = 0.15;

/** Why a session failed, so a surface can say something specific. */
export type MsePlayerErrorCode =
  | "mse-unsupported"
  | "codec-unknown"
  | "codec-unsupported"
  | "source-buffer-rejected"
  | "relay-token-unavailable"
  | "relay-refused";

export interface MsePlayerError {
  code: MsePlayerErrorCode;
  message: string;
}

export interface MsePlayerOptions {
  /**
   * Called each time the session hits a failure. Every failure except
   * `mse-unsupported` is followed by a reconnect on the fixed cadence, so a
   * caller shows the message until the element's `playing` event says frames
   * flow again.
   *
   * These used to be bare `return`s, which is how the codec mismatch became
   * a silent black screen: the pane stayed connected, empty and quiet.
   */
  onError?: (err: MsePlayerError) => void;
  /**
   * Fetches a viewer token scoped to THIS device, called before every
   * connection attempt so a reconnect never presents an expired one.
   * A rejection is reported as `relay-token-unavailable` with the
   * rejection's message, and the dial is retried.
   *
   * The relay refuses an unauthenticated upgrade. A browser `WebSocket`
   * cannot set an `Authorization` header, so the token rides in the query
   * string.
   */
  getRelayToken?: () => Promise<string>;
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
  /** Armed for each dial; cleared by `open`. See {@link CONNECT_DEADLINE_MS}. */
  private connectDeadline: TimerHandle | null = null;
  private onError: ((err: MsePlayerError) => void) | null = null;
  /**
   * The options this session was started with, retained so `reconnect()` can
   * re-pass them. `reconnect()` used to call `start()` with three arguments,
   * which dropped the caller's `onError` on the first reconnect — so a relay
   * that failed after one successful minute went silent again.
   */
  private options: MsePlayerOptions | undefined;
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
  /**
   * Sockets in a row that closed (or timed out) before opening, across
   * reconnects. Reset by a successful open and by a caller's `start()`,
   * never by `reconnect()`, so a relay that keeps refusing is reported.
   */
  private preOpenFailures = 0;
  /**
   * Bumped by every `stop()`, so a token fetch that resolves after its
   * session was torn down or replaced does not open a socket for it.
   */
  private sessionSeq = 0;

  start(
    deviceId: string,
    videoElement: HTMLVideoElement,
    videoRelayUrl?: string,
    options?: MsePlayerOptions,
  ): void {
    this.preOpenFailures = 0;
    this.beginSession(deviceId, videoElement, videoRelayUrl, options);
  }

  private beginSession(
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
    if (options !== undefined) this.options = options;
    if (this.options?.onError !== undefined) this.onError = this.options.onError;

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
   * Report a session failure to the caller. Every call site except
   * `mse-unsupported` then schedules a reconnect, so the report says why
   * frames are not flowing right now, not that the session has ended.
   *
   * Every one of these sites used to be a bare `return`. That is how the
   * hardcoded codec became a silent black screen rather than a message.
   */
  private fail(code: MsePlayerErrorCode, message: string): void {
    console.warn(`[mse-player] ${code}: ${message}`);
    this.onError?.({ code, message });
  }

  /**
   * The local recording surface used to live here — a second
   * `MediaRecorder` over `videoElement.captureStream()`, with its own
   * chunk array and its own download. It had no caller: the only
   * invocation left was `stop()` calling its own `stopRecording()`.
   * `video/webrtc/recording` is the one local-capture path.
   */

  stop(): void {
    // Latch teardown so the imminent socket close does not bounce back
    // through scheduleReconnect(). reconnect() re-issues the session, which
    // clears the latch for the new one.
    this.tearingDown = true;
    this.sessionSeq += 1;
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
    this.reconnectScheduled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectDeadline();
    this.dropSocket();
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

  /**
   * Detach every handler BEFORE close() so the close event of a socket the
   * player chose to drop does not fire scheduleReconnect() a second time.
   */
  private dropSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    ws.close();
  }

  private clearConnectDeadline(): void {
    if (this.connectDeadline) {
      clearTimeout(this.connectDeadline);
      this.connectDeadline = null;
    }
  }

  /**
   * Count a dial that ended before its socket opened, and report it once
   * the silent allowance is used up. The caller schedules the retry.
   */
  private notePreOpenFailure(message: string): void {
    this.preOpenFailures += 1;
    if (this.preOpenFailures > SILENT_PRE_OPEN_RETRIES) {
      this.fail("relay-refused", message);
    }
  }

  /** Fetch a fresh viewer token when the caller supplies a source, then dial. */
  private connectWebSocket(): void {
    this.clearConnectDeadline();
    this.connectDeadline = setTimeout(() => {
      this.connectDeadline = null;
      this.dropSocket();
      this.notePreOpenFailure(
        `the video relay did not open a connection within ${CONNECT_DEADLINE_MS / 1000} s`,
      );
      this.scheduleReconnect();
    }, CONNECT_DEADLINE_MS);

    const getRelayToken = this.options?.getRelayToken;
    if (!getRelayToken) {
      this.openSocket(null);
      return;
    }
    // `stop()` bumps the sequence, so a token that lands after its session
    // was torn down or replaced is dropped; so is one that lands after the
    // connect deadline already gave up on this dial.
    const seq = this.sessionSeq;
    getRelayToken().then(
      (token) => {
        if (seq === this.sessionSeq && !this.reconnectScheduled) this.openSocket(token);
      },
      (err: unknown) => {
        if (seq !== this.sessionSeq || this.reconnectScheduled) return;
        this.clearConnectDeadline();
        this.fail(
          "relay-token-unavailable",
          err instanceof Error ? err.message : String(err),
        );
        this.scheduleReconnect();
      },
    );
  }

  private openSocket(token: string | null): void {
    const url = token
      ? `${this.videoRelayUrl}/ws/stream/${this.deviceId}?token=${encodeURIComponent(token)}`
      : `${this.videoRelayUrl}/ws/stream/${this.deviceId}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.clearConnectDeadline();
      this.preOpenFailures = 0;
      // Fresh connection — reset the stall baseline and clear the
      // reconnect guard so a later failure can schedule again.
      this.reconnectScheduled = false;
      this.lastPlaybackAdvanceAt = Date.now();
      this.lastPlaybackTime = this.videoElement?.currentTime ?? 0;
    };

    ws.onmessage = (event) => {
      const data = event.data as ArrayBuffer;
      this.appendBuffer(data);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (!opened) {
        this.clearConnectDeadline();
        this.notePreOpenFailure(
          "the video relay closed the connection before it opened: the viewer token was refused or the relay is unreachable",
        );
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
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
    const options = this.options;
    if (!video || !deviceId) return;
    // stop() clears timers + tracks + nulls videoElement; rebuild the
    // pipeline with the captured references. The options go back in too:
    // without them the caller's error handler survived exactly one session.
    // `beginSession`, not `start`, so the run of pre-open failures carries
    // over and a relay that keeps refusing stays reported while it retries.
    this.stop();
    this.beginSession(deviceId, video, relayUrl, options);
  }

  private appendBuffer(data: ArrayBuffer): void {
    if (!this.mediaSource || this.mediaSource.readyState !== "open") return;

    // The first message is the fMP4 init segment, which is where the codec
    // comes from. Passing a hardcoded string here was the silent-black-screen
    // bug: the source buffer is created against a codec the bytes are not,
    // every subsequent append is refused, and nothing says so.
    // A failure here is reported, then the session is rebuilt on the fixed
    // cadence (the stream's codec can change when the drone's pipeline is
    // reconfigured). Later segments of the doomed session are ignored.
    if (this.reconnectScheduled) return;
    if (!this.sourceBuffer && !this.openSourceBuffer(data)) {
      this.scheduleReconnect();
      return;
    }

    // NOT followed by a trim: `enqueue` has just called `appendBuffer`, so
    // `updating` is true and `remove()` would throw. The trim runs from
    // `updateend`, the only moment it is legal.
    this.enqueue(data);
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
      // Reclaim before appending more. `remove()` is only legal while the
      // buffer is idle, which is exactly here — calling it right after an
      // append (as this used to) hit the `updating` guard every time, so
      // the trim never ran on a live stream and the buffer grew until the
      // browser raised QuotaExceededError and the feed froze.
      //
      // A removal raises its own `updateend`, which re-enters this handler
      // and does the flush then; returning here keeps the two operations
      // from racing for the buffer.
      if (this.trimBehindPlayhead()) return;
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
   * Returns true when a removal was started, in which case the buffer is
   * busy and the caller must wait for the next `updateend`.
   *
   * The old rule only trimmed once `currentTime > 10`, which never fires on
   * a stream that never advances — precisely the wedged case where the
   * buffer most needs reclaiming.
   */
  private trimBehindPlayhead(): boolean {
    const buffer = this.sourceBuffer;
    const video = this.videoElement;
    if (!buffer || !video || buffer.updating) return false;
    const cutoff = video.currentTime - RETAINED_BEHIND_S;
    if (cutoff <= 0) return false;
    try {
      if (buffer.buffered.length > 0 && buffer.buffered.start(0) < cutoff) {
        buffer.remove(0, cutoff);
        return true;
      }
    } catch {
      // A remove can still be refused mid-teardown; the next updateend retries.
    }
    return false;
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
