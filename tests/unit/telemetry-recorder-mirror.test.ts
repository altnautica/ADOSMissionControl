/**
 * A plugin's recording runs in its own slot fed from the drone's frame
 * stream: it records what the operator's flight recording records, and
 * stopping it leaves the flight recording running.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: async (k: string) => store.get(k),
    set: async (k: string, v: unknown) => {
      store.set(k, v);
    },
    del: async (k: string) => {
      store.delete(k);
    },
    keys: async () => [...store.keys()],
  };
});

import {
  isRecordingFor,
  recordFrameFor,
  startMirrorRecording,
  startRecordingFor,
  stopRecordingFor,
} from "@/lib/telemetry-recorder";

const DRONE = "node:d1";
const PLUGIN_SLOT = "plugin:com.example.survey:node:d1";

afterEach(async () => {
  await stopRecordingFor(PLUGIN_SLOT);
  await stopRecordingFor(DRONE);
});

describe("plugin recording slot", () => {
  it("records the drone's frames and stops without touching the flight recording", async () => {
    startRecordingFor(DRONE, "Drone 1");
    startMirrorRecording(PLUGIN_SLOT, DRONE, "Drone 1");

    recordFrameFor(DRONE, "attitude", { roll: 1 });

    const plugin = await stopRecordingFor(PLUGIN_SLOT);
    expect(plugin).toMatchObject({ frameCount: 1, droneId: DRONE, droneName: "Drone 1" });
    expect(isRecordingFor(DRONE)).toBe(true);

    recordFrameFor(DRONE, "position", { lat: 1 });
    const flight = await stopRecordingFor(DRONE);
    expect(flight?.frameCount).toBe(2);
  });
});
