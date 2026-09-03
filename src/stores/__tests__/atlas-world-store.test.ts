/**
 * @license GPL-3.0-only
 *
 * The world-model descriptor store: folding raw stream frames, accounting for
 * every refusal, and keeping one drone's world out of another's view.
 *
 * The refusal accounting is not cosmetic. A frame the GCS cannot read must leave
 * the generation ABSENT rather than half-built, because "no world model" and "an
 * empty world" are different statements and a dropped frame must not silently
 * turn the first into the second.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  selectDeviceWorld,
  useAtlasWorldStore,
  EMPTY_DEVICE_WORLD,
} from "../atlas-world-store";
import {
  PLUGIN_ATLAS_MESH_TOPIC,
  PLUGIN_ATLAS_OCCUPANCY_TOPIC,
  PLUGIN_ATLAS_POINTCLOUD_TOPIC,
  PLUGIN_ATLAS_POSE_TOPIC,
  PLUGIN_ATLAS_SPLAT_TOPIC,
} from "@/lib/atlas/world-contract";
import {
  encodeTestEvent,
  encodeTestMap,
  GOLDEN_CLOUD_HEX,
  GOLDEN_EVENT_HEX,
  GOLDEN_OCCUPANCY_ESDF_HEX,
  GOLDEN_SPLAT_HEX,
  hexBytes,
} from "@/lib/atlas/__tests__/golden-atlas-frames";

const DRONE = "drone-1";

function world(deviceId = DRONE) {
  return selectDeviceWorld(deviceId)(useAtlasWorldStore.getState());
}

function apply(frame: Uint8Array, deviceId = DRONE, nowMs = 1_000) {
  useAtlasWorldStore.getState().applyFrame(deviceId, frame, nowMs);
}

beforeEach(() => {
  useAtlasWorldStore.getState().clear();
});

describe("applyFrame", () => {
  it("folds a producer frame into the device's newest generation", () => {
    apply(hexBytes(GOLDEN_EVENT_HEX));
    const w = world();
    expect(w.generation?.generation).toBe(7);
    expect(w.generation?.sessionId).toBe("atlas-drone-1-1000");
    expect(w.generation?.splat?.gaussianCount).toBe(1_250_000);
    expect(w.acceptedDescriptors).toBe(1);
    expect(w.lastDescriptorAt).toBe(1_000);
  });

  it("assembles one generation from its separate descriptor events", () => {
    apply(hexBytes(GOLDEN_EVENT_HEX));
    apply(
      encodeTestEvent(
        PLUGIN_ATLAS_POINTCLOUD_TOPIC,
        DRONE,
        hexBytes(GOLDEN_CLOUD_HEX),
      ),
    );
    apply(
      encodeTestEvent(
        PLUGIN_ATLAS_OCCUPANCY_TOPIC,
        DRONE,
        hexBytes(GOLDEN_OCCUPANCY_ESDF_HEX),
      ),
    );
    const g = world().generation;
    expect(g?.splat?.gaussianCount).toBe(1_250_000);
    expect(g?.pointcloud?.pointCount).toBe(480_000);
    expect(g?.occupancy?.field).toBe("esdf");
    // The generation produced no mesh, and that stays null rather than becoming
    // an empty mesh.
    expect(g?.mesh).toBeNull();
    expect(world().acceptedDescriptors).toBe(3);
  });

  it("counts a superseded descriptor and keeps the newer generation", () => {
    apply(hexBytes(GOLDEN_EVENT_HEX)); // generation 7
    apply(
      encodeTestEvent(
        PLUGIN_ATLAS_SPLAT_TOPIC,
        DRONE,
        encodeTestMap({
          session_id: "atlas-drone-1-1000",
          generation: 6,
          gaussian_count: 1,
          step: 1,
        }),
      ),
    );
    const w = world();
    expect(w.generation?.generation).toBe(7);
    expect(w.generation?.splat?.gaussianCount).toBe(1_250_000);
    expect(w.supersededDescriptors).toBe(1);
    expect(w.acceptedDescriptors).toBe(1);
  });
});

describe("refusals leave the world model ABSENT, not empty", () => {
  it("counts an unsupported envelope version and names it", () => {
    apply(
      encodeTestEvent(
        PLUGIN_ATLAS_SPLAT_TOPIC,
        DRONE,
        hexBytes(GOLDEN_SPLAT_HEX),
        2,
      ),
    );
    const w = world();
    expect(w.versionRejectedFrames).toBe(1);
    expect(w.rejectedVersion).toBe(2);
    expect(w.generation).toBeNull();
    expect(w.acceptedDescriptors).toBe(0);
  });

  it("counts a malformed frame", () => {
    apply(hexBytes("81a16b"));
    expect(world().malformedFrames).toBe(1);
    expect(world().generation).toBeNull();
  });

  it("counts a well-formed non-envelope separately from a malformed one", () => {
    apply(hexBytes("81a5746f706963a178"));
    expect(world().shapeRejectedFrames).toBe(1);
    expect(world().malformedFrames).toBe(0);
  });

  it("counts a frame on a non-artifact topic as off-topic, not as a descriptor", () => {
    // The live pose lane shares the socket; it is not a world-model artifact.
    apply(
      encodeTestEvent(PLUGIN_ATLAS_POSE_TOPIC, DRONE, hexBytes(GOLDEN_SPLAT_HEX)),
    );
    const w = world();
    expect(w.offTopicFrames).toBe(1);
    expect(w.generation).toBeNull();
  });

  it("counts an artifact frame whose payload is not a descriptor map", () => {
    apply(encodeTestEvent(PLUGIN_ATLAS_MESH_TOPIC, DRONE, hexBytes("9101")));
    expect(world().offTopicFrames).toBe(1);
    expect(world().generation).toBeNull();
  });
});

describe("per-device isolation", () => {
  it("never surfaces one drone's world under another drone", () => {
    apply(hexBytes(GOLDEN_EVENT_HEX), "drone-1");
    expect(world("drone-1").generation?.generation).toBe(7);
    expect(world("drone-2")).toBe(EMPTY_DEVICE_WORLD);
    expect(world("drone-2").generation).toBeNull();
  });

  it("returns a stable empty slice for an unknown or missing device", () => {
    // A stable reference is what stops a subscriber re-rendering on every other
    // device's frame.
    expect(world("nobody")).toBe(world("nobody"));
    expect(selectDeviceWorld(null)(useAtlasWorldStore.getState())).toBe(
      EMPTY_DEVICE_WORLD,
    );
  });
});

describe("status and lifecycle", () => {
  it("records the stream status without disturbing the generation", () => {
    apply(hexBytes(GOLDEN_EVENT_HEX));
    useAtlasWorldStore.getState().setStatus(DRONE, "reconnecting");
    expect(world().status).toBe("reconnecting");
    // The world a node published is still the newest thing known about this
    // drone, so a transport change must not blank it.
    expect(world().generation?.generation).toBe(7);
  });

  it("no-ops a repeated status so a reconnect loop cannot churn subscribers", () => {
    useAtlasWorldStore.getState().setStatus(DRONE, "connected");
    const before = world();
    useAtlasWorldStore.getState().setStatus(DRONE, "connected");
    expect(world()).toBe(before);
  });

  it("drops a device's slice on clearDevice and every slice on clear", () => {
    apply(hexBytes(GOLDEN_EVENT_HEX), "drone-1");
    apply(hexBytes(GOLDEN_EVENT_HEX), "drone-2");
    useAtlasWorldStore.getState().clearDevice("drone-1");
    expect(world("drone-1").generation).toBeNull();
    expect(world("drone-2").generation?.generation).toBe(7);
    useAtlasWorldStore.getState().clear();
    expect(world("drone-2").generation).toBeNull();
  });
});
