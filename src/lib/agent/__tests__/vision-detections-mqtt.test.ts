/**
 * @module vision-detections-mqtt.test
 * @description Tests the cloud-relay detection path: a JSON detection batch on
 * the `ados/{deviceId}/vision/detections` MQTT topic parses via
 * `parseWireDetectionJson` and lands in the SAME store the LAN WebSocket
 * feeds, readable under the node selection id the overlays use; malformed
 * payloads are dropped (never thrown).
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ingestCloudDetections, parseWireDetectionJson } from "@/lib/agent/vision-detections-ws";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

const DEVICE = "charlie-3";

/** A detection batch as the agent forwards it (contract snake_case) — the
 * exact shape the LAN WebSocket already parses, so the cloud path maps
 * identically. */
const WIRE = JSON.stringify({
  model_id: "yolov8n",
  camera_id: "cam-0",
  frame_id: 42,
  ts_ms: 123456,
  frame_width: 1280,
  frame_height: 720,
  detections: [
    {
      bbox: { x: 10, y: 20, width: 30, height: 40 },
      class_label: "person",
      confidence: 0.9,
      track_id: 7,
      lock_state: "locked",
    },
  ],
});

describe("parseWireDetectionJson", () => {
  it("maps the contract snake_case JSON onto the store's camelCase batch", () => {
    const batch = parseWireDetectionJson(WIRE);
    expect(batch).not.toBeNull();
    expect(batch!.modelId).toBe("yolov8n");
    expect(batch!.cameraId).toBe("cam-0");
    expect(batch!.frameId).toBe(42);
    expect(batch!.tsMs).toBe(123456);
    expect(batch!.frameWidth).toBe(1280);
    expect(batch!.frameHeight).toBe(720);
    expect(batch!.detections).toHaveLength(1);
    const d = batch!.detections[0]!;
    expect(d.classLabel).toBe("person");
    expect(d.trackId).toBe(7);
    expect(d.lockState).toBe("locked");
    expect(d.bbox).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("drops malformed / non-object payloads (returns null, never throws)", () => {
    expect(parseWireDetectionJson("not json {")).toBeNull();
    expect(parseWireDetectionJson("[1,2,3]")).toBeNull();
    expect(parseWireDetectionJson("42")).toBeNull();
    expect(parseWireDetectionJson("null")).toBeNull();
  });
});

describe("cloud-relay detection routing", () => {
  beforeEach(() => {
    useVisionDetectionsStore.getState().clear();
  });

  it("stores a cloud batch where the overlays read it: under the node selection id", () => {
    ingestCloudDetections(DEVICE, WIRE);

    // Every overlay reads the batch with the selected node id.
    const stored = useVisionDetectionsStore.getState().batches[nodeIdForDevice(DEVICE)];
    expect(stored).toBeDefined();
    expect(stored!.modelId).toBe("yolov8n");
    expect(stored!.detections[0]!.classLabel).toBe("person");
    expect(useVisionDetectionsStore.getState().batches[DEVICE]).toBeUndefined();
  });

  it("drops a malformed cloud payload without storing anything", () => {
    ingestCloudDetections(DEVICE, "not json {");
    expect(useVisionDetectionsStore.getState().batches[nodeIdForDevice(DEVICE)]).toBeUndefined();
  });
});
