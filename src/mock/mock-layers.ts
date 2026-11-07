/**
 * @module mock/mock-layers
 * @description Demo-mode overlay frames for the cockpit layer stack, built
 * from the agent's golden wire fixtures so demo draws exactly what the parser
 * accepts from a live drone:
 *
 * - `ar` at 20 Hz: the golden frame, its items drifting slowly so keyed
 *   interpolation and the route/motion groups are exercised;
 * - `obstacles` at 20 Hz: the golden frame, its 72 sectors breathing in and
 *   out so the bottom arc strip moves;
 * - `depth` at 5 Hz and `surfaces` at 1 Hz: the golden frames, re-stamped.
 *
 * Every frame goes through the same parse → frame-store path a live nav
 * stream frame takes. The fixtures' camera id `main` is mapped to the demo
 * drone's active video leg. Started and stopped with the demo nav feed.
 *
 * @license GPL-3.0-only
 */

import arFixture from "@/lib/cockpit/layers/fixtures/ar-frame.json";
import depthFixture from "@/lib/cockpit/layers/fixtures/depth-frame.json";
import obstaclesFixture from "@/lib/cockpit/layers/fixtures/obstacles-frame.json";
import surfacesFixture from "@/lib/cockpit/layers/fixtures/surfaces-frame.json";
import { parseNavFrame, ingestNavFrame } from "@/lib/agent/nav-stream";
import { clearFrames } from "@/lib/cockpit/layers/frame-store";

const AR_MS = 50;
const OBSTACLE_MS = 50;
const DEPTH_MS = 200;
const SURFACES_MS = 1000;

type Json = Record<string, unknown>;

/** Shift every normalised coordinate of an `ar` item by (dx, dy). */
function shiftItem(it: Json, dx: number, dy: number): Json {
  const out: Json = { ...it };
  for (const [kx, ky] of [
    ["x", "y"],
    ["gx", "gy"],
    ["cx", "cy"],
  ] as const) {
    if (typeof out[kx] === "number") out[kx] = (out[kx] as number) + dx;
    if (typeof out[ky] === "number") out[ky] = (out[ky] as number) + dy;
  }
  if (Array.isArray(out.pts)) out.pts = (out.pts as [number, number][]).map(([x, y]) => [x + dx, y + dy]);
  return out;
}

/** The demo `ar` frame `tSec` into the cycle, on camera `cameraId`. */
export function demoArFrame(tSec: number, cameraId: string, tsMs: number): Json {
  const src = arFixture as Json;
  const cam = (src.cameras as Record<string, Json>).main;
  const dx = 0.03 * Math.sin(tSec * 0.6);
  const dy = 0.015 * Math.sin(tSec * 0.9);
  return {
    ...src,
    ts_ms: tsMs,
    cameras: { [cameraId]: { ...cam, items: (cam.items as Json[]).map((it) => shiftItem(it, dx, dy)) } },
  };
}

/** The demo `obstacles` frame: the golden sectors scaled by 0.6–1.4 over a
 * slow cycle, the golden per-camera grid on `cameraId`. */
export function demoObstaclesFrame(tSec: number, cameraId: string, tsMs: number): Json {
  const k = 1 + 0.4 * Math.sin(tSec * 0.4);
  const src = obstaclesFixture as Json;
  return {
    ...src,
    ts_ms: tsMs,
    sectors_m: (src.sectors_m as (number | null)[]).map((m) => (m === null ? null : m * k)),
    cameras: { [cameraId]: (src.cameras as Record<string, Json>).main },
  };
}

function restamp(src: Json, cameraId: string, tsMs: number): Json {
  const cams = src.cameras as Record<string, Json> | undefined;
  return cams
    ? { ...src, ts_ms: tsMs, cameras: { [cameraId]: cams.main } }
    : { ...src, ts_ms: tsMs, camera_id: cameraId };
}

export class MockLayerStream {
  private droneId: string | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private startMs = 0;

  constructor(private readonly cameraOf: (droneId: string) => string) {}

  start(droneId: string, startMs: number): void {
    this.stop();
    this.droneId = droneId;
    this.startMs = startMs;
    this.timers = [
      setInterval(() => this.emit("ar", (t, cam, ts) => demoArFrame(t, cam, ts)), AR_MS),
      setInterval(() => this.emit("obstacles", (t, cam, ts) => demoObstaclesFrame(t, cam, ts)), OBSTACLE_MS),
      setInterval(() => this.emit("depth", (_t, cam, ts) => restamp(depthFixture as Json, cam, ts)), DEPTH_MS),
      setInterval(() => this.emit("surfaces", (_t, cam, ts) => restamp(surfacesFixture as Json, cam, ts)), SURFACES_MS),
    ];
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.droneId) clearFrames(this.droneId);
    this.droneId = null;
  }

  private emit(kind: string, build: (tSec: number, cameraId: string, tsMs: number) => Json): void {
    const droneId = this.droneId;
    if (!droneId) return;
    const now = Date.now();
    const frame = parseNavFrame({ kind, ts_ms: now, data: build((now - this.startMs) / 1000, this.cameraOf(droneId), now) });
    if (frame) ingestNavFrame(droneId, frame, now);
  }
}
