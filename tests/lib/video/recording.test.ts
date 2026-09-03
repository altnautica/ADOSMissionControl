/**
 * Regression net for local capture.
 *
 * Three bugs, all in ten lines:
 *
 * 1. `stopRecording()` built the Blob synchronously on the line after
 *    `stop()`. The spec fires the final `dataavailable` before `stop`, so
 *    every file shipped missing its last chunk AND that chunk stayed in the
 *    module's array to be prepended to the next take. One missing await, two
 *    bugs, and both silent.
 * 2. `new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8,opus" })`
 *    with no `isTypeSupported` guard. On a browser that cannot mux VP8 the
 *    constructor throws and REC surfaces nothing.
 * 3. `canvas.toDataURL` for a still: a 1080p frame base64-encodes to
 *    megabytes of string, parsed straight back into the same bytes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  pickRecordingMimeType,
  startRecording,
  stopRecording,
} from "@/lib/video/webrtc/recording";
import {
  getRecordedChunks,
  resetSessionStateForTest,
  setVideoElementRef,
} from "@/lib/video/webrtc/session-state";
import { useVideoStore } from "@/stores/video-store";

/**
 * A MediaRecorder stand-in with the spec's stop ordering: the final
 * `dataavailable` fires, and only then `stop`.
 */
class FakeRecorder {
  static supported: string[] = [];
  static instances: FakeRecorder[] = [];

  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readonly mimeType: string;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "video/webm";
    if (options?.mimeType && !FakeRecorder.supported.includes(options.mimeType)) {
      throw new Error(`unsupported mimeType: ${options.mimeType}`);
    }
    FakeRecorder.instances.push(this);
  }

  static isTypeSupported(type: string): boolean {
    return FakeRecorder.supported.includes(type);
  }

  start(): void {
    this.state = "recording";
  }

  /** Deliver a chunk, as a 1 s interval would. */
  emit(text: string): void {
    this.ondataavailable?.({ data: new Blob([text]) });
  }

  /**
   * `stop()` returns immediately; the trailing `dataavailable` and then
   * `stop` are queued as tasks. That asynchrony IS the bug: anything that
   * reads the chunk array on the line after `stop()` runs before either
   * event has fired.
   */
  stop(): void {
    this.state = "inactive";
    queueMicrotask(() => {
      this.emit("tail");
      queueMicrotask(() => this.onstop?.());
    });
  }

  /**
   * The recorder stopping itself, as it does when the stream's tracks end
   * under it. No `onstop` handler is installed until `stopRecording` runs,
   * so the chunks land in the array with nothing to finalise them.
   */
  selfStop(): void {
    this.state = "inactive";
    this.emit("abandoned");
  }
}

function stubVideoElement(): void {
  const stream = {
    getTracks: () => [],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
  setVideoElementRef({
    srcObject: stream,
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
  } as unknown as HTMLVideoElement);
}

beforeEach(() => {
  resetSessionStateForTest();
  FakeRecorder.instances = [];
  FakeRecorder.supported = ["video/mp4;codecs=avc1", "video/webm;codecs=vp8"];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  // The download path is incidental here; keep it from touching the DOM.
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:stub",
    revokeObjectURL: () => {},
  });
  // `document.createElement` is overloaded per tag name; the stub answers
  // every call the same way, so the implementation is cast once here rather
  // than satisfying nine overloads.
  vi.spyOn(document, "createElement").mockImplementation(
    (() => ({ href: "", download: "", click: () => {} })) as unknown as typeof document.createElement,
  );
  useVideoStore.getState().setRecording(false);
});

describe("container selection", () => {
  it("prefers MP4/AVC, which is a remux of an H.264 track", () => {
    expect(pickRecordingMimeType()).toBe("video/mp4;codecs=avc1");
  });

  it("falls back to WebM when MP4 muxing is unavailable", () => {
    FakeRecorder.supported = ["video/webm;codecs=vp8"];
    expect(pickRecordingMimeType()).toBe("video/webm;codecs=vp8");
  });

  it("returns null rather than asserting a container nothing supports", () => {
    FakeRecorder.supported = [];
    expect(pickRecordingMimeType()).toBeNull();
  });

  it("constructs a recorder on a browser that supports no listed container", () => {
    // The unguarded constructor call was the failure: it threw, and REC
    // surfaced nothing at all.
    FakeRecorder.supported = [];
    stubVideoElement();
    expect(() => startRecording()).not.toThrow();
    expect(useVideoStore.getState().isRecording).toBe(true);
  });
});

describe("stopping a take", () => {
  it("includes the trailing chunk in the file", async () => {
    stubVideoElement();
    startRecording();
    const recorder = FakeRecorder.instances[0];
    recorder.emit("body");

    const blob = await stopRecording();
    expect(blob).not.toBeNull();
    // "body" + "tail". Resolving before the final dataavailable drops the
    // tail, and the operator has no way to tell.
    expect(await blob!.text()).toBe("bodytail");
  });

  it("does not leak the trailing chunk into the next take", async () => {
    stubVideoElement();
    startRecording();
    FakeRecorder.instances[0].emit("first");
    await stopRecording();
    expect(getRecordedChunks()).toEqual([]);

    startRecording();
    FakeRecorder.instances[1].emit("second");
    const blob = await stopRecording();
    expect(await blob!.text()).toBe("secondtail");
  });

  it("discards an abandoned take's chunks when the next one starts", async () => {
    stubVideoElement();
    startRecording();
    // The stream's tracks ended under the recorder, so it stopped itself
    // with no finalizer installed. Those bytes belong to a take nobody will
    // ever download; carrying them into the next file is the same
    // cross-take contamination in a second costume.
    FakeRecorder.instances[0].selfStop();
    expect(getRecordedChunks().length).toBeGreaterThan(0);

    startRecording();
    FakeRecorder.instances[1].emit("clean");
    const blob = await stopRecording();
    expect(await blob!.text()).toBe("cleantail");
  });


  it("names the file after the container actually used", async () => {
    const anchors: { download: string }[] = [];
    vi.spyOn(document, "createElement").mockImplementation((() => {
      const a = { href: "", download: "", click: () => {} };
      anchors.push(a);
      return a;
    }) as unknown as typeof document.createElement);
    stubVideoElement();
    startRecording();
    FakeRecorder.instances[0].emit("x");
    await stopRecording();
    expect(anchors[0].download).toMatch(/\.mp4$/);
  });

  it("resolves null and clears state when nothing is recording", async () => {
    expect(await stopRecording()).toBeNull();
    expect(useVideoStore.getState().isRecording).toBe(false);
  });

  it("never rejects, because every caller invokes it unawaited", async () => {
    stubVideoElement();
    startRecording();
    const recorder = FakeRecorder.instances[0];
    recorder.stop = () => {
      throw new Error("stop failed");
    };
    // A rejection here surfaces as an unhandled rejection from a cleanup
    // path, which is not something an operator can act on.
    await expect(stopRecording()).resolves.toBeNull();
  });

  it("refuses to start with no active stream", () => {
    setVideoElementRef(null);
    expect(() => startRecording()).toThrow(/No active stream/);
  });
});
