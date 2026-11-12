/**
 * @module mock/mock-vision-nav
 * @description Demo stand-in for the Vision Navigation extension's node tab
 * (`com.altnautica.vision-nav`, panel `vision-nav-tab`, at the published release
 * in `extension-manifests.ts`). The extension
 * ships its panel as a signed iframe bundle that demo mode cannot load, so the
 * demo mounts an in-memory inline module through the same plugin slot host
 * (`PluginSlot` → `InlinePluginHost`) on the demo drone that has the extension
 * installed. The module renders the panel's cards against
 * {@link getMockVisionNavHealth}, refreshed at the heartbeat cadence.
 *
 * The health payload mirrors the extension's `navigation` telemetry block
 * key for key (`HealthSnapshot::to_value` in the extension's agent half):
 * every key is always present, an unset optional rides as `null`, and the
 * pre-arm report is the gate's `{ mode, armable, checks }` map. The
 * `nav.state` event the Navigation feed card reads is mirrored by
 * {@link getMockVisionNavState}.
 *
 * @license GPL-3.0-only
 */

import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";
import { demoInlineTab } from "./demo-inline-tab";
import { demoReleaseManifest, VISION_NAV } from "./extension-manifests";
import { jitter } from "./agent/utils";

export const VISION_NAV_PLUGIN_ID = "com.altnautica.vision-nav";
export const VISION_NAV_PANEL_ID = "vision-nav-tab";
export const VISION_NAV_VERSION = demoReleaseManifest(VISION_NAV).version;

/** Heartbeat cadence the panel refreshes its health snapshot at. */
export const VISION_NAV_REFRESH_MS = 1000;

export type VisionNavMode = "off" | "optical_flow" | "optical_flow_degraded" | "external_nav";
export type VisionNavCheckSeverity = "ok" | "pending" | "blocking";

export interface VisionNavPreArmCheck {
  id: string;
  severity: VisionNavCheckSeverity;
  detail: string;
}

export interface VisionNavPreArmReport {
  mode: VisionNavMode;
  armable: boolean;
  checks: VisionNavPreArmCheck[];
}

/** The extension's `navigation` block, in the order its agent emits the keys. */
export interface VisionNavHealth {
  opticalFlowSupported: boolean;
  rangefinderTopology: "companion" | "fc" | "both" | null;
  recommendedCameraId: string | null;
  flowQuality: number | null;
  flowRateHz: number | null;
  flowDistanceM: number | null;
  companionState: "active" | "critical" | "terminating" | "inactive";
  mode: VisionNavMode | null;
  availableEstimators: string[];
  estimatorState: "off" | "init" | "converging" | "converged" | "degraded" | "failed";
  flowScaleSource: "rangefinder" | "baro" | "gps" | "vision" | "static" | null;
  imuSource: string | null;
  imuRateHz: number | null;
  cameraImuSyncOffsetMs: number | null;
  cameraIntrinsicsLoaded: boolean;
  preArmReport: VisionNavPreArmReport | null;
  emitErrors: number;
  rangefinderError: string | null;
  degradedReasons: string[];
  fcParams: string[];
  /** Median age of a pose when its ODOMETRY is sent; null outside external nav. */
  poseAgeMs: number | null;
}

/** The `navigation` block keys, in emit order. */
export const VISION_NAV_HEALTH_KEYS = [
  "opticalFlowSupported",
  "rangefinderTopology",
  "recommendedCameraId",
  "flowQuality",
  "flowRateHz",
  "flowDistanceM",
  "companionState",
  "mode",
  "availableEstimators",
  "estimatorState",
  "flowScaleSource",
  "imuSource",
  "imuRateHz",
  "cameraImuSyncOffsetMs",
  "cameraIntrinsicsLoaded",
  "preArmReport",
  "emitErrors",
  "rangefinderError",
  "degradedReasons",
  "fcParams",
  "poseAgeMs",
] as const satisfies ReadonlyArray<keyof VisionNavHealth>;

/** The estimators the extension can run, sorted as its agent sorts them. */
const AVAILABLE_ESTIMATORS = ["external_nav", "off", "optical_flow", "optical_flow_degraded"];

/**
 * Steady-state health of a converged optical-flow run with a companion
 * rangefinder: flow quality well above the 50/255 gate, a fresh in-range
 * reading, the camera calibrated, RAW_IMU feeding the aligner. The pre-arm
 * checks and their detail strings are the gate's own, computed from the same
 * values so the card and the readings never disagree. Values jitter per call
 * so the live panel moves.
 */
export function getMockVisionNavHealth(): VisionNavHealth {
  const flowQuality = Math.round(jitter(186, 10));
  const distanceM = Math.round(jitter(1.25, 0.04) * 100) / 100;
  return {
    opticalFlowSupported: true,
    rangefinderTopology: "companion",
    recommendedCameraId: "/dev/video0",
    flowQuality,
    flowRateHz: Math.round(jitter(29.6, 0.3) * 10) / 10,
    flowDistanceM: distanceM,
    companionState: "active",
    mode: "optical_flow",
    availableEstimators: [...AVAILABLE_ESTIMATORS],
    estimatorState: "converged",
    flowScaleSource: "rangefinder",
    imuSource: "mavlink-raw-imu",
    imuRateHz: Math.round(jitter(100, 2) * 10) / 10,
    cameraImuSyncOffsetMs: Math.round(jitter(4.2, 0.8) * 10) / 10,
    cameraIntrinsicsLoaded: true,
    preArmReport: {
      mode: "optical_flow",
      armable: true,
      checks: [
        { id: "companion_active", severity: "ok", detail: "" },
        { id: "flow_quality", severity: "ok", detail: `Quality ${flowQuality}/255.` },
        {
          id: "rangefinder",
          severity: "ok",
          detail: `Topology: companion, ${distanceM.toFixed(2)} m`,
        },
      ],
    },
    emitErrors: 0,
    rangefinderError: null,
    degradedReasons: [],
    fcParams: [],
    poseAgeMs: null,
  };
}

/** Tracking health of the external pose feed. */
export type VisionNavExtnavHealth = "good" | "degraded" | "lost";

/** The extension's `nav.state` event (snake_case wire): what the navigation
 * feed is doing now. Fields the running mode does not produce are null. */
export interface VisionNavState {
  mode: VisionNavMode;
  active_set: number | null;
  extnav_health: VisionNavExtnavHealth | null;
  odom_rate_hz: number | null;
  last_reset_counter: number | null;
  obstacle_rate_hz: number | null;
  min_obstacle_m: number | null;
  gps_fix: number;
}

/** `nav.state` for the demo's optical-flow run: no external pose or obstacle
 * feed, so those fields are null, and no GPS (the reason to fly on flow). The
 * EKF source set is the flow set the operator switched to. */
export function getMockVisionNavState(): VisionNavState {
  return {
    mode: "optical_flow",
    active_set: 2,
    extnav_health: null,
    odom_rate_hz: null,
    last_reset_counter: null,
    obstacle_rate_hz: null,
    min_obstacle_m: null,
    gps_fix: 0,
  };
}

/** The inline module the demo mounts in place of the extension's bundle. The
 * React panel is imported on mount, not at module load: the plugin
 * contribution producer imports this file on every route, and the panel only
 * belongs in the chunk a demo session opens. */
export const DEMO_VISION_NAV_MODULE: InlinePluginModule = {
  async mount(root, host) {
    const { mountVisionNavDemoPanel } = await import("./vision-nav-demo-panel");
    return mountVisionNavDemoPanel(root, host);
  },
};

/**
 * The demo Vision Nav tab body for a drone, or null when that demo drone does
 * not run the extension. Keyed by the same install row the tab header reads,
 * so the body mounts under the header the operator clicked.
 */
export const getDemoVisionNavContribution = demoInlineTab(VISION_NAV, VISION_NAV_PANEL_ID, DEMO_VISION_NAV_MODULE);
