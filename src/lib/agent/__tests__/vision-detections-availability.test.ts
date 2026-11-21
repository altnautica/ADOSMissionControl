/**
 * @module vision-detections-availability.test
 * @description The live-detection socket's engine-availability path: the
 * agent closes the stream with `{"available":false,...}` as the close reason
 * when its vision engine is unreachable, which flags the drone "vision not
 * running"; the next batch clears it. Other closes are plain redials.
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SubscribeOptions } from "@/lib/api/ground-station/ws";

const subscribed: SubscribeOptions<unknown>[] = [];

vi.mock("@/lib/api/ground-station/ws", () => ({
  subscribeWebSocket: (opts: SubscribeOptions<unknown>) => {
    subscribed.push(opts);
    return () => {};
  },
}));

import { connectVisionDetections, detectionVersionNotice } from "../vision-detections-ws";
import { CONTRACT_VERSIONS } from "@/lib/plugins/contracts.generated";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

const DRONE = "node:d1";
/** The agent's close reason for an unreachable engine. */
const UNAVAILABLE_REASON = '{"available":false,"error":"E_VISION_DETECTIONS_UNAVAILABLE"}';

function open(): SubscribeOptions<unknown> {
  connectVisionDetections({ droneId: DRONE, agentUrl: "http://drone.test:8080", apiKey: null });
  const opts = subscribed.at(-1);
  if (!opts) throw new Error("no subscription opened");
  return opts;
}

describe("connectVisionDetections engine availability", () => {
  beforeEach(() => {
    subscribed.length = 0;
    useVisionDetectionsStore.getState().clear();
  });

  it("flags vision not running when the agent closes with available:false", () => {
    open().onClose?.(1011, UNAVAILABLE_REASON);
    expect(useVisionDetectionsStore.getState().visionUnavailable[DRONE]).toBe(true);
  });

  it("ignores a close without an availability report", () => {
    const opts = open();
    opts.onClose?.(1000, "");
    opts.onClose?.(1006, "not json");
    opts.onClose?.(1011, '{"error":"E_OTHER"}');
    expect(DRONE in useVisionDetectionsStore.getState().visionUnavailable).toBe(false);
  });

  it("clears the flag when a batch arrives again", () => {
    const opts = open();
    opts.onClose?.(1011, UNAVAILABLE_REASON);
    opts.onEvent({ model_id: "person", camera_id: "uvc-0", frame_id: 1, ts_ms: Date.now(), detections: [] });
    const state = useVisionDetectionsStore.getState();
    expect(DRONE in state.visionUnavailable).toBe(false);
    expect(state.batches[DRONE]?.modelId).toBe("person");
  });

  it("flags an older wire version instead of dropping it silently, and a current batch clears it", () => {
    const opts = open();
    opts.onEvent({ v: 2, model_id: "person", camera_id: "uvc-0", frame_id: 1, ts_ms: 1, detections: [] });
    let state = useVisionDetectionsStore.getState();
    expect(state.outdatedDetectionVersion[DRONE]).toBe(2);
    expect(state.batches[DRONE]).toBeUndefined();
    expect(detectionVersionNotice(2)).toContain("update the agent");
    opts.onEvent({ v: CONTRACT_VERSIONS["vision.detection"], model_id: "person", camera_id: "uvc-0", frame_id: 2, ts_ms: Date.now(), detections: [] });
    state = useVisionDetectionsStore.getState();
    expect(DRONE in state.outdatedDetectionVersion).toBe(false);
    expect(state.batches[DRONE]?.frameId).toBe(2);
  });
});
