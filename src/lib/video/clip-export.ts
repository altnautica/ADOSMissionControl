/**
 * @module video/clip-export
 * @description The GCS half of clip export: read the agent's recorded
 * segment inventory, and cut a clip out of it.
 *
 * Until now an operator could watch a feed and not extract anything from it.
 * The browser-side `MediaRecorder` in `./webrtc/recording` is not the answer
 * to that — it can only capture what the tab happened to be displaying while
 * it happened to be open. The recording that matters is the one the agent
 * writes continuously with mediamtx's native fMP4 recorder, and the agent now
 * serves both the inventory and the cut.
 *
 * ## The route contract this is built against
 *
 * From `ADOSDroneAgent/crates/ados-control/src/routes/gs_recording_list.rs`:
 *
 * > - **`GET /api/v1/ground-station/recording/segments?path=<p>`** — mediamtx's
 * >   playback segment list for one stream path, relayed verbatim.
 * > - **`GET /api/v1/ground-station/recording/clip?path=&start=&duration=`** —
 * >   mediamtx's playback `/get`, which answers fMP4 a browser `<video>` plays
 * >   directly.
 * > - **`DELETE /api/v1/ground-station/recording/<segment>`** — remove one
 * >   segment file from the recordings directory.
 *
 * Every route is profile-gated (`404` `E_PROFILE_MISMATCH` off a
 * drone-profile node) and every error is
 * `{"detail": {"error": {"code", "message"}}}`.
 *
 * Two consequences worth stating, because both are easy to get wrong:
 *
 * 1. **The `url` mediamtx puts in each segment entry is unusable here.** The
 *    playback server is bound to loopback `127.0.0.1:9996` precisely so it
 *    never faces the network, and the agent's route is the authenticated way
 *    in. So the clip URL is composed against the agent front, never taken
 *    from the inventory.
 * 2. **The parameter bounds are the agent's, mirrored.** `validateClipRequest`
 *    enforces the same allow-list and the same `0 < duration <= 3600` the Rust
 *    `validated_clip` does, so a bad mark-out is refused with the reason
 *    rather than as an opaque `400` from a round trip.
 *
 * @license GPL-3.0-only
 */

import {
  agentRequest,
  type RequestContext,
} from "@/lib/agent/agent-client/transport";

/** Route prefix, matching `ados-control`'s `routes/mod.rs` registrations. */
const RECORDING_BASE = "/api/v1/ground-station/recording";

/**
 * Longest clip the agent will cut, from `MAX_CLIP_DURATION_S` in
 * `gs_recording_list.rs`. Mirrored rather than discovered: the agent refuses
 * anything longer, and finding that out by asking costs a round trip and
 * hands the operator a `400` instead of a sentence.
 */
export const MAX_CLIP_DURATION_S = 3600;

/** Longest stream path the agent forwards (`MAX_STREAM_PATH`). */
const MAX_STREAM_PATH = 64;

/** The agent's stream-path allow-list: `[A-Za-z0-9._-]`, and no `..`. */
const STREAM_PATH_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * One recorded timespan, as mediamtx reports it and the agent relays it.
 *
 * `duration` is seconds (a float — segments are nominally 60 s but the one
 * being written is shorter, and a restart truncates one). mediamtx also emits
 * a `url` field, deliberately not modelled: see the module note.
 */
export interface RecordingSegment {
  /** RFC 3339 timestamp of the first frame in the segment. */
  start: string;
  /** Seconds of media in the segment. */
  duration: number;
}

/** A clip cut request, in the agent's own parameter vocabulary. */
export interface ClipRequest {
  /** mediamtx stream path, e.g. `main`. */
  path: string;
  /** RFC 3339 mark-in. */
  start: string;
  /** Seconds of media to cut. */
  durationSec: number;
}

/**
 * The agent's stable rejection codes for this surface. Kept as a union rather
 * than a string so a caller mapping them to operator-facing copy gets a
 * compile error when the agent adds one.
 */
export type RecordingErrorCode =
  | "E_PROFILE_MISMATCH"
  | "E_INVALID_PATH"
  | "E_INVALID_START"
  | "E_INVALID_DURATION"
  | "E_PLAYBACK_UNAVAILABLE"
  | "E_SEGMENT_NOT_FOUND"
  | "E_UNKNOWN";

export class RecordingRequestError extends Error {
  readonly code: RecordingErrorCode;

  constructor(code: RecordingErrorCode, message: string) {
    super(message);
    this.name = "RecordingRequestError";
    this.code = code;
  }
}

/** True when `value` parses as an RFC 3339 / ISO 8601 instant. */
function isRfc3339(value: string): boolean {
  // A shape gate before the parse: `Date.parse` accepts plenty that RFC 3339
  // does not (`"2026-09-04"`, `"Sep 4 2026"`), and the agent parses strictly.
  if (!/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

/**
 * Check a clip request against the agent's own bounds.
 *
 * Returns `null` when it will be accepted, or the error the agent would have
 * answered with — same code, so a caller has one mapping to operator copy
 * whether the rejection came from here or from the wire.
 */
export function validateClipRequest(
  request: ClipRequest,
): RecordingRequestError | null {
  const { path, start, durationSec } = request;
  if (
    !path ||
    path.length > MAX_STREAM_PATH ||
    path.includes("..") ||
    !STREAM_PATH_PATTERN.test(path)
  ) {
    return new RecordingRequestError(
      "E_INVALID_PATH",
      "path must be a stream name of letters, digits, '.', '_' or '-'",
    );
  }
  if (!isRfc3339(start)) {
    return new RecordingRequestError(
      "E_INVALID_START",
      "start must be an RFC 3339 timestamp",
    );
  }
  if (
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    durationSec > MAX_CLIP_DURATION_S
  ) {
    return new RecordingRequestError(
      "E_INVALID_DURATION",
      `duration must be greater than 0 and at most ${MAX_CLIP_DURATION_S} seconds`,
    );
  }
  return null;
}

/** Parse the relayed mediamtx inventory, dropping anything malformed. */
export function parseSegments(payload: unknown): RecordingSegment[] {
  if (!Array.isArray(payload)) return [];
  const out: RecordingSegment[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { start?: unknown; duration?: unknown };
    if (typeof record.start !== "string" || !isRfc3339(record.start)) continue;
    if (typeof record.duration !== "number" || !(record.duration > 0)) continue;
    out.push({ start: record.start, duration: record.duration });
  }
  // mediamtx lists in recording order; sorting makes that a guarantee rather
  // than an observation, because the merge below depends on it.
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out;
}

/**
 * The recorded segment inventory for one stream path.
 *
 * Throws {@link RecordingRequestError} rather than the transport's generic
 * `Agent API <status>: <text>`, so a caller can distinguish "this node is not
 * a ground station" from "the playback server is down" from "that path does
 * not exist" — three very different things to tell an operator.
 */
export async function listRecordingSegments(
  ctx: RequestContext,
  path: string,
  signal?: AbortSignal,
): Promise<RecordingSegment[]> {
  const invalid = validateClipRequest({
    path,
    // Only `path` is under test here; the other two are placeholders that
    // pass so a bad path is reported as a bad path.
    start: new Date(0).toISOString(),
    durationSec: 1,
  });
  if (invalid) throw invalid;

  const payload = await request<unknown>(
    ctx,
    `${RECORDING_BASE}/segments?path=${encodeURIComponent(path)}`,
    signal,
  );
  return parseSegments(payload);
}

/** Absolute URL for a clip cut, composed against the agent front. */
export function clipUrl(ctx: RequestContext, request: ClipRequest): string {
  const query = new URLSearchParams({
    path: request.path,
    start: request.start,
    duration: String(request.durationSec),
  });
  return `${ctx.baseUrl}${RECORDING_BASE}/clip?${query.toString()}`;
}

/**
 * Fetch a clip as fMP4 bytes.
 *
 * A `fetch` rather than pointing a `<video src>` at {@link clipUrl}: the
 * route is authenticated with the `X-ADOS-Key` header, and a media element
 * cannot send a header. The caller gets a `Blob`, wraps it in an object URL
 * for playback or hands it to a download, and revokes it when done.
 *
 * `durationSec` is the operator's window, so it is bounded by the agent's
 * 3600 s ceiling — but a clip is held whole in memory here, so a caller
 * offering the full hour should say so in the UI rather than discovering it
 * as a tab crash.
 */
export async function fetchRecordingClip(
  ctx: RequestContext,
  clip: ClipRequest,
  signal?: AbortSignal,
): Promise<Blob> {
  const invalid = validateClipRequest(clip);
  if (invalid) throw invalid;

  const headers: Record<string, string> = {};
  if (ctx.apiKey) headers["X-ADOS-Key"] = ctx.apiKey;

  const response = await fetch(clipUrl(ctx, clip), { headers, signal });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return response.blob();
}

/** Remove one segment file from the agent's recordings directory. */
export async function deleteRecordingSegment(
  ctx: RequestContext,
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!filename || filename.includes("/") || filename.includes("..")) {
    throw new RecordingRequestError(
      "E_INVALID_PATH",
      "segment must name one file inside the recordings directory",
    );
  }
  await request<unknown>(
    ctx,
    `${RECORDING_BASE}/${encodeURIComponent(filename)}`,
    signal,
    "DELETE",
  );
}

/**
 * A clip window centred on an event, clamped to the agent's ceiling.
 *
 * This is the whole "export the 30 s around this event" primitive: with the
 * recorder running continuously the pre-roll is already on disk, so a window
 * before an event is a query rather than a ring buffer somebody has to size.
 */
export function clipWindowAround(
  path: string,
  eventIso: string,
  preRollSec: number,
  postRollSec: number,
): ClipRequest | null {
  const eventMs = Date.parse(eventIso);
  if (!Number.isFinite(eventMs)) return null;
  const pre = Math.max(preRollSec, 0);
  const post = Math.max(postRollSec, 0);
  const durationSec = Math.min(pre + post, MAX_CLIP_DURATION_S);
  if (durationSec <= 0) return null;
  return {
    path,
    start: new Date(eventMs - pre * 1000).toISOString(),
    durationSec,
  };
}

/** A contiguous span of recorded media, in epoch ms. */
export interface RecordedRange {
  startMs: number;
  endMs: number;
}

/**
 * Merge the segment list into contiguous ranges.
 *
 * Segments are one file per minute, so a half-hour of recording is thirty
 * entries with no gap; a restart or a retention delete leaves a real hole.
 * The operator needs the holes, not the file boundaries.
 *
 * `toleranceMs` absorbs the sub-millisecond seam between consecutive
 * segments, which would otherwise fragment a continuous recording into one
 * range per file.
 */
export function recordedRanges(
  segments: readonly RecordingSegment[],
  toleranceMs = 250,
): RecordedRange[] {
  const ranges: RecordedRange[] = [];
  for (const segment of segments) {
    const startMs = Date.parse(segment.start);
    if (!Number.isFinite(startMs)) continue;
    const endMs = startMs + segment.duration * 1000;
    const last = ranges[ranges.length - 1];
    if (last && startMs - last.endMs <= toleranceMs) {
      if (endMs > last.endMs) last.endMs = endMs;
      continue;
    }
    ranges.push({ startMs, endMs });
  }
  return ranges;
}

/**
 * Whether a requested window is fully covered by recorded media.
 *
 * Asking the agent for a window it never wrote gets a short clip or an empty
 * one, with nothing saying which — so the UI checks first and can name the
 * gap instead of handing over a file that silently stops early.
 */
export function isWindowRecorded(
  segments: readonly RecordingSegment[],
  clip: ClipRequest,
): boolean {
  const startMs = Date.parse(clip.start);
  if (!Number.isFinite(startMs)) return false;
  const endMs = startMs + clip.durationSec * 1000;
  return recordedRanges(segments).some(
    (range) => range.startMs <= startMs && range.endMs >= endMs,
  );
}

/**
 * `agentRequest` with the recording surface's error envelope decoded.
 *
 * The transport throws `Agent API <status>: <body text>` for every failure,
 * which collapses six distinguishable outcomes into one string. This reads
 * the response first so the code survives.
 */
async function request<T>(
  ctx: RequestContext,
  path: string,
  signal?: AbortSignal,
  method?: string,
): Promise<T> {
  try {
    return await agentRequest<T>(ctx, path, { method, signal });
  } catch (err) {
    throw recordingErrorFrom(err);
  }
}

/** Map a transport error onto a code, keeping the agent's message. */
export function recordingErrorFrom(err: unknown): Error {
  if (err instanceof RecordingRequestError) return err;
  if (!(err instanceof Error)) {
    return new RecordingRequestError("E_UNKNOWN", String(err));
  }
  const code = extractCode(err.message);
  return code
    ? new RecordingRequestError(code, err.message)
    : err;
}

const KNOWN_CODES: Record<string, RecordingErrorCode> = {
  E_PROFILE_MISMATCH: "E_PROFILE_MISMATCH",
  E_INVALID_PATH: "E_INVALID_PATH",
  E_INVALID_START: "E_INVALID_START",
  E_INVALID_DURATION: "E_INVALID_DURATION",
  E_PLAYBACK_UNAVAILABLE: "E_PLAYBACK_UNAVAILABLE",
  E_SEGMENT_NOT_FOUND: "E_SEGMENT_NOT_FOUND",
};

/** Pull the agent's error code out of a body, wherever it was nested. */
function extractCode(body: string): RecordingErrorCode | null {
  for (const key of Object.keys(KNOWN_CODES)) {
    if (body.includes(key)) return KNOWN_CODES[key];
  }
  return null;
}

/** Decode a non-`ok` clip response into a typed error. */
async function errorFromResponse(response: Response): Promise<Error> {
  const text = await response.text().catch(() => "");
  const code = extractCode(text);
  if (code) {
    return new RecordingRequestError(code, text || response.statusText);
  }
  return new RecordingRequestError(
    "E_UNKNOWN",
    `clip request failed: ${response.status} ${response.statusText}`,
  );
}
