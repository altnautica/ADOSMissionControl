/**
 * @module video/webrtc/recording
 * @description Local capture of what this browser is currently seeing:
 * MediaRecorder bindings plus a canvas still. Each function reads the active
 * video element from the shared session state.
 *
 * This is deliberately the *smaller* of the two recording paths. It records
 * the decoded stream as displayed, so it inherits every downlink compromise
 * and stops the moment the tab does. The archival path is the agent's own
 * fMP4 recorder, exported through `../clip-export` — that is what an operator
 * should reach for when the recording has to survive.
 *
 * @license GPL-3.0-only
 */

import { useVideoStore } from "@/stores/video-store";
import {
  clearRecordedChunks,
  getMediaRecorder,
  getRecordedChunks,
  getVideoElement,
  pushRecordedChunk,
  setMediaRecorder,
} from "./session-state";

/**
 * Container preference, most preferred first.
 *
 * MP4/AVC comes first because the received track is already H.264 on every
 * profile this GCS talks to, so an MP4 container is a remux rather than a
 * transcode, and the result opens in tools that will not touch a WebM. VP8
 * WebM is the fallback for a browser that can only mux WebM — it forces a
 * software VP8 encode of an H.264 stream, which is why it is not the default.
 *
 * The previous code passed `video/webm;codecs=vp8,opus` unconditionally with
 * no `isTypeSupported` guard, so on a browser without VP8 muxing the
 * `MediaRecorder` constructor threw and the REC button surfaced nothing.
 */
const MIME_PREFERENCE = [
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/** File extension for a chosen container. */
function extensionFor(mimeType: string): string {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

/**
 * The first container this browser will actually mux, or `null` when it
 * supports none of them.
 *
 * Exported for the regression test: the failure this guards against is a
 * constructor throw, which is invisible until someone presses REC.
 */
export function pickRecordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const isSupported = MediaRecorder.isTypeSupported;
  if (typeof isSupported !== "function") {
    // No feature test available: the constructor is the only test left, so
    // let it decide rather than asserting a container it may not have.
    return null;
  }
  for (const candidate of MIME_PREFERENCE) {
    try {
      if (isSupported.call(MediaRecorder, candidate)) return candidate;
    } catch {
      // A browser that throws from the feature test itself. Try the next.
    }
  }
  return null;
}

/** Trigger a browser download for `blob`. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking in the same task can cancel the download the click just
  // started — the URL has to outlive the navigation the click schedules.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Start recording the displayed stream to a local file. */
export function startRecording(): void {
  const el = getVideoElement();
  if (!el?.srcObject) {
    throw new Error("No active stream to record");
  }

  const store = useVideoStore.getState();
  // Clearing here is what stops the previous take's trailing chunk from
  // being prepended to this one.
  clearRecordedChunks();

  const stream = el.srcObject as MediaStream;
  const mimeType = pickRecordingMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  setMediaRecorder(recorder);

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) pushRecordedChunk(e.data);
  };

  recorder.start(1000); // 1-second chunks
  store.setRecording(true);
}

/**
 * Stop recording, download the file, and resolve with the blob.
 *
 * Resolves on the recorder's `stop` event, which the spec guarantees fires
 * *after* the final `dataavailable`. The previous version built the blob
 * synchronously on the line after `stop()`, so it shipped a file missing its
 * last chunk and then leaked that chunk into the front of the next take —
 * two bugs from one missing await.
 *
 * Never rejects: every caller invokes this from a cleanup path or an
 * unawaited click handler, where a rejection would surface as an unhandled
 * rejection rather than as anything an operator could act on.
 */
export function stopRecording(): Promise<Blob | null> {
  const store = useVideoStore.getState();
  const recorder = getMediaRecorder();

  if (!recorder || recorder.state === "inactive") {
    store.setRecording(false);
    setMediaRecorder(null);
    clearRecordedChunks();
    return Promise.resolve(null);
  }

  const mimeType = recorder.mimeType || "video/webm";

  return new Promise<Blob | null>((resolve) => {
    const finish = () => {
      try {
        const chunks = getRecordedChunks();
        const blob = chunks.length
          ? new Blob(chunks, { type: mimeType })
          : null;
        clearRecordedChunks();
        setMediaRecorder(null);
        if (blob) {
          download(
            blob,
            `altnautica-recording-${Date.now()}.${extensionFor(mimeType)}`,
          );
        }
        resolve(blob);
      } catch (err) {
        console.warn("[webrtc-client] recording finalize failed", err);
        clearRecordedChunks();
        setMediaRecorder(null);
        resolve(null);
      }
    };

    recorder.onstop = finish;
    recorder.onerror = (err) => {
      console.warn("[webrtc-client] recorder error", err);
      finish();
    };
    try {
      recorder.stop();
    } catch (err) {
      console.warn("[webrtc-client] recorder stop failed", err);
      finish();
    }
    store.setRecording(false);
  });
}

/**
 * Capture the current video frame as a PNG and download it.
 *
 * `toBlob`, not `toDataURL`: a 1080p frame base64-encodes to several
 * megabytes of string that is then parsed straight back into the same bytes,
 * which is a whole round trip to hand the download a Blob it could have had
 * directly.
 */
export function captureScreenshot(): Promise<Blob | null> {
  const el = getVideoElement();
  if (!el || el.readyState < 2) return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = el.videoWidth;
  canvas.height = el.videoHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(el, 0, 0);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        download(blob, `altnautica-screenshot-${Date.now()}.png`);
      }
      resolve(blob);
    }, "image/png");
  });
}
