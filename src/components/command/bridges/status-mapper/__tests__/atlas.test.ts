/**
 * @license GPL-3.0-only
 *
 * Unit tests for buildAtlasPatch: the fan-out that maps the heartbeat's generic
 * `pluginState.atlas` slice (the Atlas plugin's own opaque telemetry) into the
 * atlas store's live slice. The slice shape is the Atlas plugin's contract; the
 * core convex schema never sees it. Covers the no-slice no-op, full + sparse
 * mapping (merge over current), and defensive coercion.
 */

import { describe, it, expect } from "vitest";
import { buildAtlasPatch, mapAtlasSlice } from "../atlas";
import { EMPTY_ATLAS_LIVE } from "@/stores/atlas-store";

const current = { live: { ...EMPTY_ATLAS_LIVE } };

/** Wrap an atlas slice in the generic pluginState envelope. */
function hb(atlas: Record<string, unknown>): Record<string, unknown> {
  return { pluginState: { atlas } };
}

describe("buildAtlasPatch", () => {
  it("returns null when there is no atlas slice", () => {
    expect(buildAtlasPatch({}, current, 1)).toBeNull();
    expect(buildAtlasPatch({ pluginState: {} }, current, 1)).toBeNull();
    expect(buildAtlasPatch({ pluginState: { other: { x: 1 } } }, current, 1)).toBeNull();
    // A present-but-empty atlas slice carries nothing to merge.
    expect(buildAtlasPatch(hb({}), current, 1)).toBeNull();
  });

  it("maps the atlas slice's capture + transport fields", () => {
    const patch = buildAtlasPatch(
      hb({
        state: "capturing",
        sessionId: "sess-1",
        keyframesIngested: 142,
        ingestRateHz: 9.5,
        cameraCount: 6,
        vioHealth: "good",
        computeNodeId: "rtx-box",
        lastKfAt: 1700,
        bearer: "direct-lan",
      }),
      current,
      999,
    );
    expect(patch).not.toBeNull();
    expect(patch!.live).toMatchObject({
      state: "capturing",
      sessionId: "sess-1",
      keyframesIngested: 142,
      ingestRateHz: 9.5,
      cameraCount: 6,
      vioHealth: "good",
      computeNodeId: "rtx-box",
      lastKfAt: 1700,
      bearer: "direct-lan",
      updatedAt: 999,
    });
  });

  it("maps the drone-side capture-quality fields (cameras + VIO health)", () => {
    const patch = buildAtlasPatch(
      hb({ state: "capturing", cameraCount: 1, vioHealth: "degraded" }),
      current,
      3,
    );
    expect(patch!.live.cameraCount).toBe(1);
    expect(patch!.live.vioHealth).toBe("degraded");
  });

  it("maps the relay transport fields", () => {
    const patch = buildAtlasPatch(
      hb({
        state: "capturing",
        bearer: "wfb-relay",
        relayGroundAgentId: "gs-01",
        relayDecimation: 4,
      }),
      current,
      5,
    );
    expect(patch!.live.bearer).toBe("wfb-relay");
    expect(patch!.live.relayGroundAgentId).toBe("gs-01");
    expect(patch!.live.relayDecimation).toBe(4);
  });

  // The agent's atlas-state sidecar carries four capture-honesty fields the GCS
  // previously dropped on the floor. Each one exists because its absence made a
  // known-false reading indistinguishable from a healthy one.
  it("maps the capture-honesty fields (capped / anchored / pose tier / drops)", () => {
    const patch = buildAtlasPatch(
      hb({
        state: "capturing",
        keyframesIngested: 400,
        capped: true,
        anchored: false,
        poseTier: "offloaded_slam",
        droppedKeyframes: 7,
      }),
      current,
      11,
    );
    // `capped` is why a frozen keyframe count against "capturing" is not a
    // stalled camera; `anchored: false` is a capture that is running and
    // producing nothing; `droppedKeyframes` is why the ingested count overstates
    // the reconstruction input.
    expect(patch!.live.capped).toBe(true);
    expect(patch!.live.anchored).toBe(false);
    expect(patch!.live.poseTier).toBe("offloaded_slam");
    expect(patch!.live.droppedKeyframes).toBe(7);
  });

  it("maps keyframesCarried, including the false the WFB relay reports", () => {
    // A `false` here means the world-model lane is degraded to pose and status —
    // no world model — while the bearer still reads as live. It must survive the
    // merge rather than being treated as absent.
    const patch = buildAtlasPatch(
      hb({ state: "capturing", bearer: "wfb-relay", keyframesCarried: false }),
      current,
      13,
    );
    expect(patch!.live.keyframesCarried).toBe(false);
    expect(patch!.live.bearer).toBe("wfb-relay");
  });

  it("leaves the honesty fields null when the agent reports none", () => {
    // No claim either way is the honest reading for a pre-field agent, so these
    // must not default to a confident false.
    const patch = buildAtlasPatch(hb({ state: "idle" }), current, 17);
    expect(patch!.live.keyframesCarried).toBeNull();
    expect(patch!.live.capped).toBeNull();
    expect(patch!.live.anchored).toBeNull();
    expect(patch!.live.poseTier).toBeNull();
    expect(patch!.live.droppedKeyframes).toBeNull();
  });

  it("merges a sparse slice over the current slice", () => {
    const prior = {
      live: {
        ...EMPTY_ATLAS_LIVE,
        state: "capturing",
        sessionId: "sess-1",
        keyframesIngested: 100,
        computeNodeId: "rtx-box",
      },
    };
    // Only the keyframe count changes; everything else is preserved.
    const patch = buildAtlasPatch(hb({ keyframesIngested: 110 }), prior, 7);
    expect(patch!.live).toMatchObject({
      state: "capturing",
      sessionId: "sess-1",
      keyframesIngested: 110,
      computeNodeId: "rtx-box",
      updatedAt: 7,
    });
  });

  it("ignores non-finite numerics (treated as absent)", () => {
    const patch = buildAtlasPatch(
      hb({ state: "capturing", ingestRateHz: Number.NaN }),
      current,
      1,
    );
    expect(patch!.live.state).toBe("capturing");
    expect(patch!.live.ingestRateHz).toBeNull();
  });
});

describe("mapAtlasSlice (the raw-slice local-first path)", () => {
  // The local poll feeds the RAW slice (the agent's flat atlas-state.json),
  // not wrapped in pluginState — the same mapping buildAtlasPatch uses after it
  // unwraps the cloud slice.
  it("maps a raw slice the same as the unwrapped cloud slice", () => {
    const slice = { state: "capturing", sessionId: "s1", cameraCount: 4, vioHealth: "good" };
    const patch = mapAtlasSlice(slice, current, 5);
    expect(patch!.live).toMatchObject({
      state: "capturing",
      sessionId: "s1",
      cameraCount: 4,
      vioHealth: "good",
      updatedAt: 5,
    });
  });

  it("returns null for an empty slice (nothing to merge)", () => {
    expect(mapAtlasSlice({}, current, 1)).toBeNull();
  });
});
