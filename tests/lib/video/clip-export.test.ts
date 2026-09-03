/**
 * Regression net for clip export.
 *
 * The gap: an operator could watch a feed and extract nothing from it. The
 * agent's `recording/segments` + `recording/clip` routes are the archival
 * path, and the whole point of this client is that its parameter bounds and
 * error codes are the agent's own, mirrored — so a bad mark-out is refused
 * locally with the reason rather than as an opaque 400 from a round trip, and
 * the six distinguishable failures stay distinguishable.
 *
 * Contract source: ADOSDroneAgent/crates/ados-control/src/routes/gs_recording_list.rs
 *   is_valid_stream_path  — [A-Za-z0-9._-], no "..", <= 64 chars
 *   validated_clip        — RFC 3339 start, 0 < duration <= MAX_CLIP_DURATION_S
 *   error_body            — {"detail": {"error": {"code", "message"}}}
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CLIP_DURATION_S,
  RecordingRequestError,
  clipUrl,
  clipWindowAround,
  deleteRecordingSegment,
  fetchRecordingClip,
  isWindowRecorded,
  listRecordingSegments,
  parseSegments,
  recordedRanges,
  validateClipRequest,
  type RecordingSegment,
} from "@/lib/video/clip-export";
import type { RequestContext } from "@/lib/agent/agent-client/transport";

/**
 * The fetch signature, named so `mock.calls[i]` is a typed tuple rather than
 * the empty tuple an untyped `vi.fn(async () => ...)` infers.
 */
type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const CTX: RequestContext = {
  baseUrl: "http://192.168.1.50:8080",
  apiKey: "test-key",
};

const VALID = {
  path: "main",
  start: "2026-09-04T12:00:00Z",
  durationSec: 30,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clip request validation mirrors the agent's bounds", () => {
  it("accepts a well-formed request", () => {
    expect(validateClipRequest(VALID)).toBeNull();
  });

  it("refuses a path outside the allow-list with the agent's code", () => {
    for (const path of ["", "main/sub", "../etc", "main stream", "a".repeat(65)]) {
      const err = validateClipRequest({ ...VALID, path });
      expect(err?.code).toBe("E_INVALID_PATH");
    }
  });

  it("refuses a start that is not RFC 3339", () => {
    // Date.parse accepts plenty RFC 3339 does not, and the agent parses
    // strictly — forwarding those costs a round trip to learn nothing.
    for (const start of ["2026-09-04", "Sep 4 2026", "", "12:00:00"]) {
      expect(validateClipRequest({ ...VALID, start })?.code).toBe(
        "E_INVALID_START",
      );
    }
    expect(
      validateClipRequest({ ...VALID, start: "2026-09-04T12:00:00.500+05:30" }),
    ).toBeNull();
  });

  it("refuses a duration outside (0, ceiling]", () => {
    for (const durationSec of [0, -1, Number.NaN, MAX_CLIP_DURATION_S + 1]) {
      expect(validateClipRequest({ ...VALID, durationSec })?.code).toBe(
        "E_INVALID_DURATION",
      );
    }
    expect(
      validateClipRequest({ ...VALID, durationSec: MAX_CLIP_DURATION_S }),
    ).toBeNull();
  });
});

describe("clip URL composition", () => {
  it("composes against the agent front, never mediamtx's own url", () => {
    const url = clipUrl(CTX, VALID);
    // The playback server binds loopback 127.0.0.1:9996 precisely so it
    // never faces the network; the `url` in each segment entry points there
    // and is unreachable from a browser.
    expect(url).not.toContain("9996");
    expect(url).not.toContain("127.0.0.1");
    expect(url).toContain(
      "http://192.168.1.50:8080/api/v1/ground-station/recording/clip",
    );
    // `+` in a non-UTC offset decodes as a space; URLSearchParams escapes it.
    const offset = clipUrl(CTX, {
      ...VALID,
      start: "2026-09-04T12:00:00+05:30",
    });
    expect(offset).toContain("start=2026-09-04T12%3A00%3A00%2B05%3A30");
    expect(offset).toContain("duration=30");
  });
});

describe("segment inventory", () => {
  it("parses the relayed mediamtx shape and drops malformed entries", () => {
    // The agent relays mediamtx verbatim; its own test fixture is
    // [{"start": ..., "duration": 60.0}].
    const parsed = parseSegments([
      { start: "2026-09-04T12:01:00Z", duration: 60 },
      { start: "2026-09-04T12:00:00Z", duration: 60 },
      { start: "not-a-timestamp", duration: 60 },
      { start: "2026-09-04T12:02:00Z", duration: 0 },
      { duration: 60 },
      null,
      "nope",
    ]);
    expect(parsed).toEqual([
      { start: "2026-09-04T12:00:00Z", duration: 60 },
      { start: "2026-09-04T12:01:00Z", duration: 60 },
    ]);
  });

  it("returns empty for a non-array payload", () => {
    expect(parseSegments({ items: [] })).toEqual([]);
    expect(parseSegments(null)).toEqual([]);
  });

  it("requests the segments route and parses the answer", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      new Response(
        JSON.stringify([{ start: "2026-09-04T12:00:00Z", duration: 60 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const segments = await listRecordingSegments(CTX, "main");
    expect(segments).toHaveLength(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(
      "http://192.168.1.50:8080/api/v1/ground-station/recording/segments?path=main",
    );
  });

  it("refuses a bad path locally instead of asking the agent", async () => {
    const fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(listRecordingSegments(CTX, "../etc")).rejects.toMatchObject({
      code: "E_INVALID_PATH",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("error codes survive the transport", () => {
  /**
   * The transport throws `Agent API <status>: <body>`, which collapses six
   * distinguishable outcomes into one string. "This node is not a ground
   * station", "the playback server is down" and "that path does not exist"
   * are three different things to tell an operator.
   */
  const cases = [
    { status: 404, code: "E_PROFILE_MISMATCH" },
    { status: 503, code: "E_PLAYBACK_UNAVAILABLE" },
    { status: 400, code: "E_INVALID_START" },
  ] as const;

  for (const { status, code } of cases) {
    it(`maps ${status} ${code} onto a typed error`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({ detail: { error: { code, message: "no" } } }),
            { status, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );
      await expect(listRecordingSegments(CTX, "main")).rejects.toMatchObject({
        code,
      });
    });
  }

  it("decodes the clip route's error envelope too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            detail: { error: { code: "E_PLAYBACK_UNAVAILABLE", message: "x" } },
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(fetchRecordingClip(CTX, VALID)).rejects.toMatchObject({
      code: "E_PLAYBACK_UNAVAILABLE",
    });
  });
});

describe("fetching a clip", () => {
  it("sends the api key as a header, which a <video src> cannot", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      new Response("fmp4-bytes", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchRecordingClip(CTX, VALID);
    expect(await blob.text()).toBe("fmp4-bytes");
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["X-ADOS-Key"]).toBe("test-key");
  });

  it("refuses an invalid window without asking the agent", async () => {
    const fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchRecordingClip(CTX, { ...VALID, durationSec: 99_999 }),
    ).rejects.toBeInstanceOf(RecordingRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deleting a segment", () => {
  it("refuses a traversal attempt locally", async () => {
    const fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", fetchMock);
    for (const name of ["", "../config.yaml", "a/b.mp4"]) {
      await expect(deleteRecordingSegment(CTX, name)).rejects.toMatchObject({
        code: "E_INVALID_PATH",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues a DELETE against the named segment", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteRecordingSegment(CTX, "2026-09-04_12-00-00-000000.mp4");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://192.168.1.50:8080/api/v1/ground-station/recording/2026-09-04_12-00-00-000000.mp4",
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
  });
});

describe("event windows and coverage", () => {
  it("builds a window straddling an event, clamped to the ceiling", () => {
    // With the recorder running continuously the pre-roll is already on
    // disk, so a window BEFORE an event is a query, not a ring buffer.
    const clip = clipWindowAround("main", "2026-09-04T12:00:30Z", 30, 10)!;
    expect(clip.start).toBe("2026-09-04T12:00:00.000Z");
    expect(clip.durationSec).toBe(40);
    expect(validateClipRequest(clip)).toBeNull();

    const clamped = clipWindowAround("main", "2026-09-04T12:00:30Z", 99_999, 0)!;
    expect(clamped.durationSec).toBe(MAX_CLIP_DURATION_S);

    expect(clipWindowAround("main", "nope", 5, 5)).toBeNull();
    expect(clipWindowAround("main", "2026-09-04T12:00:30Z", 0, 0)).toBeNull();
  });

  it("merges one-file-per-minute segments into contiguous ranges", () => {
    const segments: RecordingSegment[] = [
      { start: "2026-09-04T12:00:00Z", duration: 60 },
      { start: "2026-09-04T12:01:00Z", duration: 60 },
      // Retention deleted the 12:02 file: a real hole, not a file boundary.
      { start: "2026-09-04T12:03:00Z", duration: 60 },
    ];
    const ranges = recordedRanges(segments);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].endMs - ranges[0].startMs).toBe(120_000);
  });

  it("refuses a window that crosses a gap in the recording", () => {
    const segments: RecordingSegment[] = [
      { start: "2026-09-04T12:00:00Z", duration: 60 },
      { start: "2026-09-04T12:03:00Z", duration: 60 },
    ];
    // Inside the first range.
    expect(
      isWindowRecorded(segments, {
        path: "main",
        start: "2026-09-04T12:00:10Z",
        durationSec: 30,
      }),
    ).toBe(true);
    // Straddles the hole. Asking anyway yields a short clip with nothing
    // saying it stopped early.
    expect(
      isWindowRecorded(segments, {
        path: "main",
        start: "2026-09-04T12:00:40Z",
        durationSec: 180,
      }),
    ).toBe(false);
  });
});
