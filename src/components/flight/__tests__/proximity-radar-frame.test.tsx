/**
 * @license GPL-3.0-only
 *
 * OBSTACLE_DISTANCE carries its angular geometry in the v2 extensions:
 * increment_f (used instead of the integer increment when non-zero),
 * angle_offset (the angle of element 0) and frame (north-aligned by default,
 * vehicle-nose-aligned for MAV_FRAME_BODY_FRD). A forward depth camera sends a
 * ~1.2 degree step starting at about -FOV/2 in the body frame, and a fused
 * body-frame map does the same with the integer increment left at 0.
 *
 * The frame is built on the wire and fed through the parser, so the payload
 * length the parser restores and the decoder offsets are both exercised.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { ProximityRadar } from "@/components/flight/ProximityRadar";
import { buildFrame } from "@/lib/protocol/encoders/frame";
import { MAVLinkParser, type MAVLinkFrame } from "@/lib/protocol/mavlink-parser";
import { handleObstacleDistance } from "@/lib/protocol/handlers/debug-handlers";
import type { ObstacleData } from "@/lib/types/telemetry";
import { useTelemetryStore } from "@/stores/telemetry-store";

const UNKNOWN = 65535;
const MAV_FRAME_BODY_FRD = 12;

/** A 167-byte OBSTACLE_DISTANCE payload, laid out as the common.xml wire order. */
function obstaclePayload(o: {
  distances: number[];
  increment: number;
  incrementF: number;
  angleOffset: number;
  frame: number;
}): Uint8Array {
  const buf = new Uint8Array(167);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 72; i++) dv.setUint16(8 + i * 2, o.distances[i] ?? UNKNOWN, true);
  dv.setUint16(152, 20, true); // min_distance
  dv.setUint16(154, 1000, true); // max_distance
  dv.setUint8(156, 0); // sensor_type
  dv.setUint8(157, o.increment);
  dv.setFloat32(158, o.incrementF, true);
  dv.setFloat32(162, o.angleOffset, true);
  dv.setUint8(166, o.frame);
  return buf;
}

/** Wire -> parser -> handler, exactly as the adapter receives it. */
function receive(payload: Uint8Array): ObstacleData {
  const parser = new MAVLinkParser();
  const frames: MAVLinkFrame[] = [];
  parser.onFrame((f) => frames.push(f));
  parser.feed(buildFrame(330, payload, 1, 1));
  expect(frames).toHaveLength(1);
  const out: ObstacleData[] = [];
  handleObstacleDistance(frames[0].payload, [(d) => out.push(d)]);
  return out[0];
}

/** The y coordinate an arc path starts at (its outer-ring start point). */
function arcStartY(d: string): number {
  const m = /^M (\S+) (\S+)/.exec(d);
  if (!m) throw new Error(`not an arc path: ${d}`);
  return Number(m[2]);
}

describe("ProximityRadar geometry from OBSTACLE_DISTANCE", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
  });
  afterEach(() => {
    cleanup();
  });

  it("draws a body-frame obstacle dead ahead at the top, labelled FWD", () => {
    // An 86 degree forward wedge: 72 x 1.2 degree sectors from -43.5 degrees,
    // with only the sector straight ahead (element 36) reporting an obstacle.
    const distances = new Array<number>(72).fill(UNKNOWN);
    distances[36] = 150;
    const sample = receive(
      obstaclePayload({
        distances,
        increment: 0,
        incrementF: 1.2,
        angleOffset: -43.5,
        frame: MAV_FRAME_BODY_FRD,
      }),
    );
    expect(sample.incrementF).toBeCloseTo(1.2, 5);
    expect(sample.angleOffset).toBeCloseTo(-43.5, 5);
    expect(sample.frame).toBe(MAV_FRAME_BODY_FRD);

    useTelemetryStore.getState().obstacle.push({ ...sample, timestamp: Date.now() });
    const { container } = render(<ProximityRadar />);

    expect(container.querySelector("text")?.textContent).toBe("FWD");
    const arcs = Array.from(container.querySelectorAll("path"));
    expect(arcs).toHaveLength(1);
    // Straight ahead is the top of the dial (centre y = 60, outer radius 52).
    expect(arcStartY(arcs[0].getAttribute("d") ?? "")).toBeLessThan(15);
    expect(container.textContent).toContain("nearest 1.5 m");
  });

  it("labels north-aligned data N and treats beyond-max readings as clear", () => {
    const distances = new Array<number>(72).fill(1001); // max_distance + 1: nothing in range
    const sample = receive(
      obstaclePayload({ distances, increment: 5, incrementF: 0, angleOffset: 0, frame: 0 }),
    );
    useTelemetryStore.getState().obstacle.push({ ...sample, timestamp: Date.now() });
    const { container } = render(<ProximityRadar />);

    expect(container.querySelector("text")?.textContent).toBe("N");
    expect(container.querySelectorAll("path")).toHaveLength(0);
    expect(container.textContent).toContain("clear");
  });
});
