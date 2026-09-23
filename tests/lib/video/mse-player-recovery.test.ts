/**
 * Behavioural contract for the MSE player, driven through fake
 * `MediaSource` / `SourceBuffer` / `WebSocket` / `<video>` doubles.
 *
 * Two things this covers that matter on a piloting feed:
 *
 *  - **Recovery.** The relay can keep a socket open while the decoder
 *    silently wedges — no `onclose`, no error event. The player must notice
 *    via a `currentTime`-advance watchdog and reopen from scratch, and must
 *    NOT bounce back into a reconnect on a deliberate `stop()`.
 *  - **Reclaim.** The source buffer must actually be trimmed on a live
 *    stream. `remove()` is only legal while the buffer is idle, so trimming
 *    straight after an append (which is what the player used to do) hit the
 *    `updating` guard every single time: the buffer grew for the whole
 *    session until the browser raised `QuotaExceededError` and the feed
 *    froze.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { MsePlayer } from "@/lib/video/mse-player";

// ── doubles ──────────────────────────────────────────────────────────

type Listener = () => void;

class FakeSourceBuffer {
  updating = false;
  removed: Array<[number, number]> = [];
  appended: ArrayBuffer[] = [];
  private listeners = new Map<string, Listener[]>();
  /** Buffered range the player sees; the test drives it directly. */
  range: { start: number; end: number } | null = null;

  get buffered() {
    const range = this.range;
    return {
      length: range ? 1 : 0,
      start: () => range?.start ?? 0,
      end: () => range?.end ?? 0,
    } as unknown as TimeRanges;
  }

  addEventListener(type: string, fn: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }

  appendBuffer(data: ArrayBuffer) {
    this.appended.push(data);
    this.updating = true;
  }

  remove(start: number, end: number) {
    this.removed.push([start, end]);
    this.updating = true;
  }

  /** Complete whatever operation is in flight, as the browser would. */
  settle() {
    this.updating = false;
    this.emit("updateend");
  }
}

class FakeMediaSource {
  readyState = "open";
  sourceBuffer = new FakeSourceBuffer();
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, fn: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }

  addSourceBuffer() {
    return this.sourceBuffer;
  }

  static isTypeSupported() {
    return true;
  }
}

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static last: FakeWebSocket | null = null;
  static opened: string[] = [];

  readyState = 1;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.last = this;
    FakeWebSocket.opened.push(url);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
}

function fakeVideo() {
  return {
    currentTime: 0,
    paused: false,
    src: "",
    play: vi.fn(() => Promise.resolve()),
    load: vi.fn(),
  } as unknown as HTMLVideoElement;
}

/**
 * Minimal fMP4 init segment the codec sniffer accepts: an `ftyp` box then a
 * `moov` carrying one `avc1` sample entry with an `avcC` profile triplet.
 */
function initSegment(): ArrayBuffer {
  const box = (type: string, payload: Uint8Array) => {
    const out = new Uint8Array(8 + payload.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(payload, 8);
    return out;
  };
  // avcC: configurationVersion, profile, compat, level
  const avcC = box("avcC", new Uint8Array([1, 0x64, 0x00, 0x1f]));
  const avc1 = box("avc1", new Uint8Array([...new Uint8Array(70), ...avcC]));
  const stsd = box("stsd", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, ...avc1]));
  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);
  const mdia = box("mdia", minf);
  const trak = box("trak", mdia);
  const moov = box("moov", trak);
  const ftyp = box("ftyp", new TextEncoder().encode("isom"));
  const all = new Uint8Array(ftyp.length + moov.length);
  all.set(ftyp);
  all.set(moov, ftyp.length);
  return all.buffer;
}

// ── harness ──────────────────────────────────────────────────────────

let ms: FakeMediaSource;

function startPlayer(video: HTMLVideoElement) {
  const player = new MsePlayer();
  player.start("drone-1", video, "wss://relay.invalid");
  ms.emit("sourceopen");
  FakeWebSocket.last!.onopen?.();
  // First message is the init segment, which creates the source buffer.
  FakeWebSocket.last!.onmessage?.({ data: initSegment() });
  return player;
}

describe("MsePlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.last = null;
    FakeWebSocket.opened = [];
    ms = new FakeMediaSource();
    class MediaSourceStub {
      constructor() {
        return ms as unknown as MediaSourceStub;
      }
      static isTypeSupported() {
        return true;
      }
    }
    vi.stubGlobal("MediaSource", MediaSourceStub);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:fake",
      revokeObjectURL: () => {},
    });
    vi.stubGlobal("window", { MediaSource: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("trims the source buffer on a live stream", () => {
    const video = fakeVideo();
    const player = startPlayer(video);
    const sb = ms.sourceBuffer;

    // Steady streaming: the playhead advances and the buffer accumulates.
    for (let i = 0; i < 20; i++) {
      sb.settle(); // previous append completes → updateend
      video.currentTime = i + 1;
      sb.range = { start: 0, end: video.currentTime + 1 };
      FakeWebSocket.last!.onmessage?.({ data: new ArrayBuffer(64) });
    }
    sb.settle();

    // Before the fix this list was empty for the life of the session.
    expect(sb.removed.length).toBeGreaterThan(0);
    const [start, end] = sb.removed.at(-1)!;
    expect(start).toBe(0);
    // Trims to five seconds behind the playhead, never ahead of it.
    expect(end).toBeLessThan(video.currentTime);
    player.stop();
  });

  it("never calls remove() while the buffer is busy", () => {
    const video = fakeVideo();
    const player = startPlayer(video);
    const sb = ms.sourceBuffer;
    const removeSpy = vi.spyOn(sb, "remove");

    for (let i = 0; i < 10; i++) {
      sb.settle();
      video.currentTime = i + 1;
      sb.range = { start: 0, end: video.currentTime + 1 };
      FakeWebSocket.last!.onmessage?.({ data: new ArrayBuffer(64) });
    }

    // Every removal must have been issued against an idle buffer; a
    // `remove()` while `updating` throws InvalidStateError in the browser.
    for (const call of removeSpy.mock.results) {
      expect(call.type).toBe("return");
    }
    player.stop();
  });

  it("reconnects when playback freezes while the socket stays open", () => {
    const video = fakeVideo();
    const player = startPlayer(video);
    expect(FakeWebSocket.opened).toHaveLength(1);

    // currentTime never advances. No close, no error — the silent wedge.
    vi.advanceTimersByTime(8000);
    // Reconnect is debounced behind a delay.
    vi.advanceTimersByTime(4000);
    ms.emit("sourceopen");

    expect(FakeWebSocket.opened.length).toBeGreaterThan(1);
    player.stop();
  });

  it("does not reconnect after a deliberate stop", () => {
    const video = fakeVideo();
    const player = startPlayer(video);
    const openedBefore = FakeWebSocket.opened.length;

    player.stop();
    vi.advanceTimersByTime(30_000);

    expect(FakeWebSocket.opened).toHaveLength(openedBefore);
  });

  it("reports an unreadable codec instead of showing a black screen", () => {
    const video = fakeVideo();
    const onError = vi.fn();
    const player = new MsePlayer();
    player.start("drone-1", video, "wss://relay.invalid", { onError });
    ms.emit("sourceopen");
    FakeWebSocket.last!.onopen?.();

    // Not an fMP4 init segment: no codec can be derived from it.
    FakeWebSocket.last!.onmessage?.({ data: new ArrayBuffer(16) });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "codec-unknown" }),
    );
    player.stop();
  });

  it("dials with a fresh token each attempt and reports a relay that keeps refusing", async () => {
    const onError = vi.fn();
    let minted = 0;
    const getRelayToken = vi.fn(async () => `tok-${++minted}`);
    const player = new MsePlayer();
    player.start("drone-1", fakeVideo(), "wss://relay.invalid", { onError, getRelayToken });
    ms.emit("sourceopen");
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.opened).toEqual(["wss://relay.invalid/ws/stream/drone-1?token=tok-1"]);

    // A refused upgrade reaches the browser as a close before `open`. The
    // first one retries with a newly minted token.
    FakeWebSocket.last!.onclose?.();
    ms = new FakeMediaSource();
    await vi.advanceTimersByTimeAsync(3000);
    ms.emit("sourceopen");
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.opened).toHaveLength(2);
    expect(FakeWebSocket.opened[1]).toContain("token=tok-2");
    expect(onError).not.toHaveBeenCalled();

    // A second refusal in a row ends the session with a reason.
    FakeWebSocket.last!.onclose?.();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocket.opened).toHaveLength(2);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "relay-refused" }));
    player.stop();
  });

  it("reports why no relay token could be obtained and never dials", async () => {
    const onError = vi.fn();
    const player = new MsePlayer();
    player.start("drone-1", fakeVideo(), "wss://relay.invalid", {
      onError,
      getRelayToken: () => Promise.reject(new Error("relay not configured")),
    });
    ms.emit("sourceopen");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocket.opened).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith({
      code: "relay-token-unavailable",
      message: "relay not configured",
    });
    player.stop();
  });
});
