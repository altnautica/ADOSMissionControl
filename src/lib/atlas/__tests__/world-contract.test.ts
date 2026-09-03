/**
 * @license GPL-3.0-only
 *
 * The atlas wire contract as the GCS speaks it: the framed envelope, the
 * shared-data capability gate, and the bearer keyframe rule. Every constant is
 * checked against the agent's own values (`ados_protocol::atlas`), and the
 * envelope version is checked against the generated contract registry so an
 * agent-side bump cannot pass this file by being hand-copied.
 */

import { describe, it, expect } from "vitest";

import { CONTRACT_VERSIONS } from "@/lib/plugins/contracts.generated";
import {
  ATLAS_ENVELOPE_VERSION,
  ATLAS_POSE_READ_CAP,
  ATLAS_WORLD_READ_CAP,
  atlasTopicSubscribeCapability,
  bearerCarriesKeyframes,
  bearerKeyframesDegraded,
  decodeAtlasEvent,
  PLUGIN_ATLAS_ARTIFACT_TOPICS,
  PLUGIN_ATLAS_MESH_TOPIC,
  PLUGIN_ATLAS_OCCUPANCY_TOPIC,
  PLUGIN_ATLAS_POINTCLOUD_TOPIC,
  PLUGIN_ATLAS_POSE_TOPIC,
  PLUGIN_ATLAS_SPLAT_TOPIC,
  PLUGIN_ATLAS_TOPICS,
} from "../world-contract";
import { asMsgpackMap, decodeMsgpack } from "../msgpack";
import {
  encodeTestEvent,
  GOLDEN_EVENT_HEX,
  GOLDEN_EVENT_NO_DEVICE_HEX,
  GOLDEN_SPLAT_HEX,
  hexBytes,
} from "./golden-atlas-frames";

describe("envelope version", () => {
  it("is sourced from the generated contract registry, not hand-copied", () => {
    expect(ATLAS_ENVELOPE_VERSION).toBe(CONTRACT_VERSIONS["atlas.envelope"]);
    expect(ATLAS_ENVELOPE_VERSION).toBe(1);
  });
});

describe("decodeAtlasEvent", () => {
  it("decodes a producer frame down to the descriptor payload", () => {
    const result = decodeAtlasEvent(hexBytes(GOLDEN_EVENT_HEX));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.v).toBe(1);
    expect(result.event.topic).toBe(PLUGIN_ATLAS_SPLAT_TOPIC);
    expect(result.event.deviceId).toBe("drone-1");
    // The payload must be byte-identical to the standalone descriptor frame,
    // which is what proves the array-of-ints payload was rebuilt correctly.
    expect(Array.from(result.event.payload)).toEqual(
      Array.from(hexBytes(GOLDEN_SPLAT_HEX)),
    );
    expect(asMsgpackMap(decodeMsgpack(result.event.payload))?.gaussian_count).toBe(
      1_250_000,
    );
  });

  it("reads a skipped device_id as null rather than failing the frame", () => {
    const result = decodeAtlasEvent(hexBytes(GOLDEN_EVENT_NO_DEVICE_HEX));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.deviceId).toBeNull();
    expect(result.event.topic).toBe(PLUGIN_ATLAS_MESH_TOPIC);
  });

  it("refuses an unsupported envelope version and names it", () => {
    const frame = encodeTestEvent(
      PLUGIN_ATLAS_SPLAT_TOPIC,
      "drone-1",
      hexBytes(GOLDEN_SPLAT_HEX),
      2,
    );
    const result = decodeAtlasEvent(frame);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("version");
    expect(result.version).toBe(2);
    expect(result.detail).toContain("this build speaks 1");
  });

  it("separates a malformed frame from a well-formed non-envelope", () => {
    const malformed = decodeAtlasEvent(hexBytes("81a16b"));
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("malformed");

    // A valid msgpack map that is not an envelope (no version field).
    const shaped = decodeAtlasEvent(hexBytes("81a5746f706963a178"));
    expect(shaped.ok).toBe(false);
    if (!shaped.ok) expect(shaped.reason).toBe("shape");
  });

  it("refuses a frame whose payload is not a byte sequence", () => {
    // v + topic + payload as a string instead of a byte array.
    const result = decodeAtlasEvent(
      hexBytes(
        "83a17601a5746f706963b2706c7567696e2e61746c61732e73706c6174a77061796c6f6164a26869",
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("shape");
      expect(result.version).toBe(1);
    }
  });
});

describe("shared-data capability gate", () => {
  it("maps the artifact topics to compute.job.read and the pose lane to telemetry.read", () => {
    expect(ATLAS_WORLD_READ_CAP).toBe("compute.job.read");
    expect(ATLAS_POSE_READ_CAP).toBe("telemetry.read");
    expect(atlasTopicSubscribeCapability(PLUGIN_ATLAS_POSE_TOPIC)).toBe(
      ATLAS_POSE_READ_CAP,
    );
    for (const topic of PLUGIN_ATLAS_ARTIFACT_TOPICS) {
      expect(atlasTopicSubscribeCapability(topic)).toBe(ATLAS_WORLD_READ_CAP);
    }
  });

  it("matches exactly, so a topic minted under a gated prefix inherits nothing", () => {
    expect(
      atlasTopicSubscribeCapability(`${PLUGIN_ATLAS_OCCUPANCY_TOPIC}.evil`),
    ).toBeNull();
    expect(atlasTopicSubscribeCapability("plugin.atlas.")).toBeNull();
    expect(atlasTopicSubscribeCapability("atlas.keyframe")).toBeNull();
  });

  it("lists every shared-data topic including the pose lane", () => {
    expect([...PLUGIN_ATLAS_TOPICS]).toEqual([
      PLUGIN_ATLAS_POSE_TOPIC,
      PLUGIN_ATLAS_POINTCLOUD_TOPIC,
      PLUGIN_ATLAS_OCCUPANCY_TOPIC,
      PLUGIN_ATLAS_SPLAT_TOPIC,
      PLUGIN_ATLAS_MESH_TOPIC,
    ]);
    // The artifact set is the topic set minus the live pose lane.
    expect(PLUGIN_ATLAS_ARTIFACT_TOPICS).toHaveLength(
      PLUGIN_ATLAS_TOPICS.length - 1,
    );
    expect([...PLUGIN_ATLAS_ARTIFACT_TOPICS]).not.toContain(
      PLUGIN_ATLAS_POSE_TOPIC,
    );
  });
});

describe("bearer keyframe rule", () => {
  it("says the WFB relay cannot carry keyframes and a LAN or cloud bearer can", () => {
    expect(bearerCarriesKeyframes("wfb-relay")).toBe(false);
    expect(bearerCarriesKeyframes("direct-lan")).toBe(true);
    expect(bearerCarriesKeyframes("cloud")).toBe(true);
  });

  it("claims no degradation when no bearer is known", () => {
    // With no bearer there is nothing honest to claim in either direction.
    expect(bearerKeyframesDegraded(null)).toBe(false);
    expect(bearerKeyframesDegraded("wfb-relay")).toBe(true);
    expect(bearerKeyframesDegraded("direct-lan")).toBe(false);
  });
});
