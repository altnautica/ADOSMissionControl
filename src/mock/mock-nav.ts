/**
 * @module mock/mock-nav
 * @description Demo-mode navigation feed. Fills `useNavStreamStore` for the
 * demo drone at the rates a live agent's nav stream delivers:
 *
 * - `follow.state` at 5 Hz from the scripted HUD cycle (`mock-hud-script`);
 * - `nav.state` at 2 Hz: external nav on the commanded EKF source set, with a
 *   degraded window while the subject is being searched for;
 * - `pose` and a 360-ray `scan` at 10 Hz: the drone flying a slow loop through
 *   a small synthetic room (`mock-nav-world`), ray-cast against its walls and
 *   pillars;
 * - occupancy tiles and `map_status` at 1 Hz, tiles revealed progressively.
 *
 * Started and stopped by `mockDetectionStream` so the target layer, follow
 * chrome, radar, minimap and Map tab all run off one clock. Loaded only
 * through the demo-mode dynamic import of `mock-detections`.
 * @license GPL-3.0-only
 */

import { mockPilot } from "./mock-pilot";
import type { MapStatus, NavState, ReacquireMode } from "@/lib/hud/nav-types";
import { pluginConfigKey, usePluginConfigCache } from "@/lib/plugins/config-cache";
import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { getMockEkfSourceSet } from "./mock-ekf-source";
import { extnavHealthAt, scriptFollow } from "./mock-hud-script";
import { demoLoopAt, scanRanges, yawMatrix } from "./mock-nav-world";
import { OccupancyReveal, type GreyPngEncoder } from "./mock-occupancy";
import { MockLayerStream } from "./mock-layers";

const FOLLOW_MS = 200;
const NAV_MS = 500;
const POSE_MS = 100;
const MAP_MS = 1000;

/** The camera id the demo pod reports on: the drone's active video leg. */
export function demoActiveCameraId(droneId: string): string {
  return useVideoStreamsStore.getState().activeStream(droneId)?.id ?? "demo-cam-0";
}

const NAV_MODE: Record<1 | 2 | 3, string> = {
  1: "external_nav",
  2: "optical_flow",
  3: "gps",
};

/** The `nav.state` frame for `tSec` into the cycle. */
export function demoNavState(tSec: number, activeSet: 1 | 2 | 3, minObstacleM: number | null): NavState {
  const health = extnavHealthAt(tSec);
  return {
    mode: NAV_MODE[activeSet],
    activeSet,
    extnavHealth: health,
    odomRateHz: health === "good" ? 30 : 18,
    lastResetCounter: Math.floor(tSec / 32),
    obstacleRateHz: 10,
    minObstacleM,
    gpsFix: null,
  };
}

const UPLOAD_TOTAL_BYTES = 48 * 1024 * 1024;
const UPLOAD_PERIOD_S = 90;

/** The `map_status` frame `tSec` into the stream with `tiles` revealed. */
export function demoMapStatus(tSec: number, tiles: number): MapStatus {
  const uploadShare = (tSec % UPLOAD_PERIOD_S) / UPLOAD_PERIOD_S;
  return {
    sessionId: "demo-session",
    placement: "hybrid",
    memoryUsedMb: Math.round(180 + Math.min(420, tSec * 2.5)),
    memoryBudgetMb: 1024,
    voxelM: 0.1,
    keyframesDropped: Math.floor(tSec / 75),
    sweepPoints: Math.round(tSec * 1800),
    // Each 3.2 m tile adds ~10 m² of floor.
    areaM2: Math.round(tiles * 10.24 * 10) / 10,
    navPose: "always",
    upload: {
      state: "uploading",
      bytesDone: Math.round(UPLOAD_TOTAL_BYTES * uploadShare),
      bytesTotal: UPLOAD_TOTAL_BYTES,
    },
    stream: { state: "off", bytesPerS: 0 },
  };
}

/** Demo navigation feed; the encoder seam lets tests stub PNG encoding. */
export class MockNavStream {
  private droneId: string | null = null;
  private startMs = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private occupancy: OccupancyReveal | null = null;
  private minObstacleM: number | null = null;
  private readonly layers = new MockLayerStream(demoActiveCameraId);

  constructor(private readonly encoder?: GreyPngEncoder) {}

  /** Start feeding `droneId` on the cycle clock that began at `startMs`. */
  start(droneId: string, startMs: number): void {
    this.stop();
    this.droneId = droneId;
    this.startMs = startMs;
    this.occupancy = new OccupancyReveal(this.encoder);
    this.timers = [
      setInterval(() => this.tickFollow(), FOLLOW_MS),
      setInterval(() => this.tickNav(), NAV_MS),
      setInterval(() => this.tickPose(), POSE_MS),
      setInterval(() => this.tickMap(), MAP_MS),
    ];
    this.layers.start(droneId, startMs);
    mockPilot.start(droneId);
    this.tickMap();
  }

  stop(): void {
    this.layers.stop();
    mockPilot.stop();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.droneId) useNavStreamStore.getState().clear(this.droneId);
    this.droneId = null;
    this.occupancy = null;
    this.minObstacleM = null;
  }

  isRunning(): boolean {
    return this.timers.length > 0;
  }

  private cycleS(): number {
    return (Date.now() - this.startMs) / 1000;
  }

  private tickFollow(): void {
    const droneId = this.droneId;
    if (!droneId) return;
    const loop = demoLoopAt(Date.now() / 1000);
    const yaw = useTelemetryStore.getState().attitude.latest()?.yaw ?? (loop.yawRad * 180) / Math.PI;
    const mode = usePluginConfigCache.getState().values[pluginConfigKey(droneId, FOLLOW_ME_PLUGIN_ID)]
      ?.reacquire_mode;
    const reacquireMode: ReacquireMode = mode === "strict" ? "strict" : "smart";
    useNavStreamStore.getState().setFollow(
      droneId,
      scriptFollow(this.cycleS(), {
        cameraId: demoActiveCameraId(droneId),
        vehicleYawDeg: yaw,
        reacquireMode,
        droneNed: [loop.x, loop.y],
      }),
    );
  }

  private tickNav(): void {
    if (!this.droneId) return;
    useNavStreamStore
      .getState()
      .setNav(this.droneId, demoNavState(this.cycleS(), getMockEkfSourceSet(), this.minObstacleM));
  }

  private tickPose(): void {
    const droneId = this.droneId;
    if (!droneId) return;
    const loop = demoLoopAt(Date.now() / 1000);
    const store = useNavStreamStore.getState();
    store.setPose(droneId, {
      R: yawMatrix(loop.yawRad),
      t: [loop.x, loop.y, loop.z],
      health: extnavHealthAt(this.cycleS()),
      frame: "map_ned",
      source: "slam",
    });
    const ranges = scanRanges(loop.x, loop.y, loop.yawRad).map((r) =>
      r > 0 ? Math.round((r + (Math.random() - 0.5) * 0.04) * 1000) / 1000 : 0,
    );
    let min = Infinity;
    for (const r of ranges) if (r > 0 && r < min) min = r;
    this.minObstacleM = Number.isFinite(min) ? Math.round(min * 100) / 100 : null;
    store.setScan(droneId, {
      frame: "body_frd",
      angleStartRad: 0,
      angleIncrementRad: (2 * Math.PI) / ranges.length,
      ranges,
    });
  }

  private tickMap(): void {
    const droneId = this.droneId;
    const occupancy = this.occupancy;
    if (!droneId || !occupancy) return;
    const store = useNavStreamStore.getState();
    store.mergeOccupancy(droneId, occupancy.next());
    store.setMap(droneId, demoMapStatus(this.cycleS(), occupancy.revealedCount));
  }
}

/** Singleton demo navigation feed. */
export const mockNavStream = new MockNavStream();
