/** Nav-stream frame parsing, store ingest and the occupancy poll. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNavStreamStore } from "@/stores/nav-stream-store";

import { ingestNavFrame, parseNavFrame, pollMapLive } from "../nav-stream";
import { parseFollowState, parseMapStatus, parseNavPose, parseNavState } from "../nav-types";

const DRONE = "node:test-1";

beforeEach(() => useNavStreamStore.setState({ byDrone: {} }));
afterEach(() => vi.restoreAllMocks());

describe("parseNavFrame", () => {
  it("parses each kind", () => {
    const follow = parseNavFrame({
      kind: "follow",
      ts_ms: 1,
      data: {
        phase: "coasting",
        track_id: 12,
        range_m: 10.2,
        range_sigma_m: 0.3,
        range_cues: [{ kind: "lidar", range_m: 10.1, sigma_m: 0.05 }, { kind: "bogus" }],
        agl_source: "rng",
        reacquire_mode: "smart",
        target_ned: [3, 4],
        predicted_bbox: { camera_id: "main", frame_w: 640, frame_h: 480, x: 1, y: 2, w: 3, h: 4 },
      },
    });
    expect(follow?.kind).toBe("follow");
    if (follow?.kind !== "follow") throw new Error();
    expect(follow.data.phase).toBe("coasting");
    expect(follow.data.rangeCues).toEqual([{ kind: "lidar", rangeM: 10.1, sigmaM: 0.05 }]);
    expect(follow.data.targetNed).toEqual([3, 4]);
    expect(follow.data.predictedBbox?.cameraId).toBe("main");

    expect(parseNavFrame({ kind: "nav", data: { mode: "external_nav", active_set: 2, extnav_health: "good" } }))
      .toMatchObject({ kind: "nav", data: { activeSet: 2, extnavHealth: "good" } });
    expect(
      parseNavFrame({ kind: "pose", data: { pose: { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [1, 2, 3] }, health: "degraded" } }),
    ).toMatchObject({ kind: "pose", data: { t: [1, 2, 3], health: "degraded", frame: "map_frd" } });
    expect(
      parseNavFrame({ kind: "scan", data: { angle_start_rad: 0, angle_increment_rad: 0.1, ranges_m: [1, null, 2] } }),
    ).toMatchObject({ kind: "scan", data: { ranges: [1, 0, 2] } });
    expect(
      parseNavFrame({ kind: "map", data: { placement: "hybrid", upload: { state: "uploading", bytes_done: 5, bytes_total: 10 } } }),
    ).toMatchObject({ kind: "map", data: { placement: "hybrid", upload: { state: "uploading", bytesDone: 5 } } });
    expect(
      parseNavFrame({ kind: "follow_event", topic: "follow.reacquired", data: { track_id: 15, similarity: 0.86, gap_s: 1.8 } }),
    ).toEqual({ kind: "follow_event", data: { topic: "follow.reacquired", trackId: 15, similarity: 0.86, gapS: 1.8 } });
    expect(parseNavFrame({ kind: "follow_event", topic: "follow.lost", data: { track_id: 12 } })).toEqual({
      kind: "follow_event",
      data: { topic: "follow.lost", trackId: 12, reason: "lock_lost" },
    });
  });

  it("rejects keepalives, unknown kinds and malformed payloads", () => {
    expect(parseNavFrame({ kind: "keepalive" })).toBeNull();
    expect(parseNavFrame({ kind: "weather", data: {} })).toBeNull();
    expect(parseNavFrame(null)).toBeNull();
    expect(parseNavFrame({ kind: "pose", data: { pose: { R: [1, 2], t: [0, 0, 0] } } })).toBeNull();
    expect(parseNavFrame({ kind: "scan", data: { angle_start_rad: 0, angle_increment_rad: 0, ranges_m: [] } })).toBeNull();
    expect(parseNavFrame({ kind: "nav", data: { active_set: 1 } })).toBeNull();
    expect(parseNavFrame({ kind: "follow_event", topic: "follow.reacquired", data: {} })).toBeNull();
    expect(parseNavFrame({ kind: "follow", data: { phase: "dancing" } })).toBeNull();
  });

  it("maps a legacy follow payload without a phase", () => {
    expect(parseFollowState({ active: false })?.phase).toBe("idle");
    expect(parseFollowState({ active: true, commanding: true })?.phase).toBe("following");
    expect(parseFollowState({ active: true })?.phase).toBe("acquiring");
  });

  it("other parsers tolerate missing fields", () => {
    expect(parseNavState({ mode: "flow", active_set: 9 })?.activeSet).toBeNull();
    expect(parseNavPose({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] })?.t).toEqual([0, 0, 0]);
    expect(parseMapStatus({})).toMatchObject({ placement: null, upload: null, stream: null });
  });
});

describe("ingest", () => {
  it("stores each frame and the trail", () => {
    ingestNavFrame(DRONE, { kind: "pose", data: parseNavPose({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], health: "good" })! }, 10);
    ingestNavFrame(DRONE, { kind: "pose", data: parseNavPose({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [1, 0, 0], health: "good" })! }, 20);
    ingestNavFrame(DRONE, { kind: "follow_event", data: { topic: "follow.lost", trackId: 3, reason: "x" } }, 30);
    const feed = useNavStreamStore.getState().byDrone[DRONE];
    expect(feed.trail).toHaveLength(2);
    expect(feed.pose?.receivedAt).toBe(20);
    expect(feed.followEvent?.data.topic).toBe("follow.lost");
    useNavStreamStore.getState().clear(DRONE);
    expect(useNavStreamStore.getState().byDrone[DRONE]).toBeUndefined();
  });
});

describe("pollMapLive", () => {
  it("asks since the held seq and merges tiles", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ seq: 4, frame: "map_frd", res_m: 0.05, tile_cells: 64, tiles: [{ ix: 0, iy: -1, png_b64: "AAA" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const ok = await pollMapLive({ baseUrl: "http://192.168.1.50:8080", apiKey: "k" }, DRONE);
    expect(ok).toBe(true);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/v1/map/live?since=0");
    const grid = useNavStreamStore.getState().byDrone[DRONE].occupancy;
    expect(grid.seq).toBe(4);
    expect(grid.tiles["0,-1"].pngB64).toBe("AAA");

    fetchSpy.mockImplementation(async () => new Response("nope", { status: 500 }));
    expect(await pollMapLive({ baseUrl: "http://192.168.1.50:8080", apiKey: "k" }, DRONE)).toBe(false);
    expect(String(fetchSpy.mock.calls[1][0])).toContain("since=4");
  });
});
