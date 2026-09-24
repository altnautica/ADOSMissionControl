/**
 * @module sim-replay-store
 * @description Session-only Zustand store holding a recorded flight track that
 * the operator loads to overlay the ACTUAL flown path on the planned mission in
 * the simulation viewer.
 *
 * Parsing happens in a `Worker` (`simulation/log-track-worker`) with the buffer
 * transferred, so a large log no longer freezes the UI while it is read. Where
 * no `Worker` exists (SSR, tests) the same pure core runs in-thread — identical
 * results, and the fallback is explicit rather than a silent difference.
 *
 * Only real logged positions are kept; a failure leaves the track null and
 * records a TYPED error (never a fabricated path). The track keeps full
 * resolution for analysis and carries a decimated copy for the draw path.
 * NOT persisted — the loaded track lives for the current session only.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import {
  decimateTrack,
  extensionOf,
  parseLogTrack,
  type LogTrackError,
  type TrackPoint,
} from "@/lib/simulation/log-track";
import type {
  LogTrackWorkerRequest,
  LogTrackWorkerResponse,
} from "@/lib/simulation/log-track-worker";

export { extractPositions, decimateTrack } from "@/lib/simulation/log-track";
export type { TrackPoint, LogTrackError } from "@/lib/simulation/log-track";

/** A loaded actual track. */
export interface ActualTrack {
  /** Every logged position, full resolution — the analysis surface. */
  positions: TrackPoint[];
  /**
   * The same track simplified for rendering. A raw log is tens of thousands of
   * sub-metre-apart vertices; submitting all of them to one Cesium polyline
   * every frame costs a lot and shows nothing extra.
   */
  renderPositions: TrackPoint[];
  /** Source log filename, shown in the control. */
  name: string;
}

/**
 * Why the last load failed. Structured rather than a bare code so the control
 * can say "truncated at 4,194,304 bytes" instead of "parse failed" — those need
 * different operator responses and used to be indistinguishable.
 */
export type SimReplayError = LogTrackError;

/** Stable, i18n-agnostic error code. The control maps each to a translated hint. */
export type SimReplayErrorCode = LogTrackError["code"];

interface SimReplayState {
  /** The loaded actual track, or null when nothing is loaded. */
  track: ActualTrack | null;
  /** Last error, or null. Cleared on a successful load or `clear()`. */
  error: SimReplayError | null;
  /** True while a log is being parsed. */
  loading: boolean;
  /** Parse a recorded log file and extract its flown positions. */
  loadFromFile: (file: File) => Promise<void>;
  /** Drop the loaded track and any error (reset). */
  clear: () => void;
}

/**
 * Cancels the in-flight parse worker, so a second load (or `clear()`) stops
 * the first. Cancelling settles the first load's promise with `null` rather
 * than leaving it pending forever.
 */
let cancelActiveWorker: (() => void) | null = null;

/**
 * Bumped by every load and by `clear()`. A load whose read or parse settles
 * after a newer load or a clear belongs to a file the operator replaced, so it
 * must not write the track, the error, or the loading flag.
 */
let loadGeneration = 0;

/**
 * Parse in a worker when the environment has one, otherwise in-thread.
 * The in-thread path is the SSR / test environment, not a silent degradation:
 * both run the same pure {@link parseLogTrack}. Resolves `null` when a newer
 * load or `clear()` cancelled this parse.
 */
function parseInWorker(
  request: LogTrackWorkerRequest,
): Promise<LogTrackWorkerResponse | null> {
  if (typeof Worker === "undefined") {
    const result = parseLogTrack(request.ext, request.buffer, request.name);
    return Promise.resolve(
      result.ok
        ? { ok: true, positions: result.positions }
        : { ok: false, error: result.error },
    );
  }

  const { promise, resolve } = Promise.withResolvers<LogTrackWorkerResponse | null>();
  const worker = new Worker(
    new URL("../lib/simulation/log-track-worker.ts", import.meta.url),
    { type: "module" },
  );
  cancelActiveWorker?.();
  const finish = (response: LogTrackWorkerResponse | null) => {
    worker.terminate();
    if (cancelActiveWorker === cancel) cancelActiveWorker = null;
    resolve(response);
  };
  const cancel = () => finish(null);
  cancelActiveWorker = cancel;

  worker.onmessage = (e: MessageEvent<LogTrackWorkerResponse>) => finish(e.data);
  worker.onerror = (e) =>
    finish({
      ok: false,
      error: { code: "parse-failed", detail: e.message || "log parse worker crashed" },
    });

  // Transfer the buffer: a flight log is tens to hundreds of megabytes and
  // structured-cloning it would double peak memory for no reason.
  worker.postMessage(request, [request.buffer]);
  return promise;
}

export const useSimReplayStore = create<SimReplayState>((set) => ({
  track: null,
  error: null,
  loading: false,

  loadFromFile: async (file: File) => {
    const generation = ++loadGeneration;
    const name = file.name;
    const ext = extensionOf(name);
    set({ loading: true, error: null });

    let response: LogTrackWorkerResponse | null;
    try {
      const buffer = await file.arrayBuffer();
      if (generation !== loadGeneration) return;
      response = await parseInWorker({ ext, name, buffer });
    } catch (err) {
      if (generation !== loadGeneration) return;
      set({
        loading: false,
        track: null,
        error: {
          code: "parse-failed",
          detail: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }
    if (response === null || generation !== loadGeneration) return;

    if (!response.ok) {
      set({ loading: false, error: response.error, track: null });
      return;
    }

    set({
      loading: false,
      track: {
        positions: response.positions,
        renderPositions: decimateTrack(response.positions),
        name,
      },
      error: null,
    });
  },

  clear: () => {
    loadGeneration += 1;
    cancelActiveWorker?.();
    set({ track: null, error: null, loading: false });
  },
}));
