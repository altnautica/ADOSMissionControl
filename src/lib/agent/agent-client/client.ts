/**
 * @module agent/agent-client/client
 * @description The `AgentClient` class. Thin orchestrator that holds
 * the (baseUrl, apiKey) context and delegates each method to the
 * per-domain helper modules under this folder.
 * @license GPL-3.0-only
 */

import type {
  AgentStatus,
  AgentVersionInfo,
  ClaimResponse,
  CommandResult,
  FcSource,
  FullStatusResponse,
  HardwareCheckStatus,
  LogEntry,
  MavlinkPort,
  MeshNetEnrollment,
  NetworkPeer,
  PairingInfo,
  PeripheralInfo,
  SetupActionResult,
  SetupStatus,
  SystemResources,
  TelemetrySnapshot,
  VideoStatus,
} from "../types";
import * as system from "./system";
import * as setup from "./setup";
import * as extras from "./extras";
import * as camera from "./camera";
import { LoggingService } from "./logging";
import type { RequestContext } from "./transport";
import { agentSupports, fetchVersionInfo } from "./version-cache";
import type {
  CameraListResponse,
  RecordingControlResponse,
  RecordingListResponse,
  SigningCapability,
  SigningCounters,
  SigningEnrollResult,
} from "./types";
import type { CameraLegInput, RosterCamera } from "../feature-types";

export class AgentClient {
  private ctx: RequestContext;

  /**
   * Durable log / telemetry / event / hardware store reader. Resolves the
   * on-device query surface over the LAN (`:8090/v1`), falling back to the
   * FastAPI proxy bridge and then the legacy `/api/logs` path so older
   * agents keep working. Constructed once per client so the resolved tier
   * is remembered across calls.
   */
  readonly logging: LoggingService;

  constructor(baseUrl: string, apiKey?: string | null) {
    this.ctx = {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      apiKey: apiKey ?? null,
    };
    this.logging = new LoggingService(this.ctx);
  }

  // ── Status / system / services / logs / params / commands ──────

  getStatus(): Promise<AgentStatus> {
    return system.getStatus(this.ctx);
  }

  /**
   * Fetch the agent's wire-protocol version + capability flags.
   * Returns null when the agent is older than 0.8.6 (does not have
   * the endpoint). Cached for 5 minutes per baseUrl+apiKey.
   */
  getVersion(opts?: { force?: boolean }): Promise<AgentVersionInfo | null> {
    return fetchVersionInfo(this.ctx, opts);
  }

  /** Convenience: does the agent advertise the named capability? */
  async supports(capability: string): Promise<boolean> {
    const info = await this.getVersion();
    return agentSupports(info, capability);
  }

  getTelemetry(): Promise<TelemetrySnapshot> {
    return system.getTelemetry(this.ctx);
  }

  getServices(agentUptimeHint?: number): ReturnType<typeof system.getServices> {
    return system.getServices(this.ctx, agentUptimeHint);
  }

  getSystemResources(): Promise<SystemResources> {
    return system.getSystemResources(this.ctx);
  }

  getLogs(params?: { level?: string; limit?: number }): Promise<LogEntry[]> {
    return system.getLogs(this.ctx, params);
  }

  getParams(): Promise<Record<string, number>> {
    return system.getParams(this.ctx);
  }

  sendCommand(cmd: string, args?: unknown[]): Promise<CommandResult> {
    return system.sendCommand(this.ctx, cmd, args);
  }

  getConfig(): Promise<Record<string, unknown>> {
    return system.getConfig(this.ctx);
  }

  /**
   * Write a single config value via PUT /api/config. Dot-separated
   * key paths are supported (e.g. `ground_station.display.type`). The
   * agent coerces the string value to the underlying field type.
   */
  setConfigValue(
    key: string,
    value: string,
  ): Promise<{ status?: string; key?: string; value?: unknown; error?: string }> {
    return system.setConfigValue(this.ctx, key, value);
  }

  restartService(name: string): Promise<CommandResult> {
    return system.restartService(this.ctx, name);
  }

  getFullStatus(): Promise<FullStatusResponse | null> {
    return system.getFullStatus(this.ctx);
  }

  /**
   * CRSF / ExpressLRS control-lane snapshot from the dedicated ground-station
   * route. Returns the raw snake_case sidecar, or null when the lane is down /
   * the sidecar is stale (404) or the node is not a ground station
   * (profile_mismatch). Not folded into `/api/status`, so it is a separate
   * request the poll loop only issues for a ground-station node.
   */
  getGroundStationCrsf(): Promise<Record<string, unknown> | null> {
    return system.getGroundStationCrsf(this.ctx);
  }

  /** Enumerate serial devices the router can bind as the FC link. */
  getMavlinkPorts(): Promise<MavlinkPort[]> {
    return system.getMavlinkPorts(this.ctx);
  }

  /** Point the MAVLink router at a chosen FC source via PUT /api/config. */
  setMavlinkSource(
    source: FcSource,
    opts?: { serialPort?: string; baudRate?: number },
  ): Promise<void> {
    return system.setMavlinkSource(this.ctx, source, opts);
  }

  /** Measure control-plane RTT to the agent (`GET /api/ping`). */
  ping(): Promise<{ rttMs: number; pong: number } | null> {
    return system.pingAgent(this.ctx);
  }

  // ── Setup wizard + LCD display ─────────────────────────────────

  getSetupStatus(): Promise<SetupStatus> {
    return setup.getSetupStatus(this.ctx);
  }

  postProfileChoice(
    profile: "drone" | "ground_station",
    ground_role?: "direct" | "relay" | "receiver" | null,
  ): Promise<SetupActionResult> {
    return setup.postProfileChoice(this.ctx, profile, ground_role);
  }

  getHardwareCheck(): Promise<HardwareCheckStatus> {
    return setup.getHardwareCheck(this.ctx);
  }

  refreshHardwareCheck(): Promise<HardwareCheckStatus> {
    return setup.refreshHardwareCheck(this.ctx);
  }

  setDisplayPage(
    page: string,
  ): Promise<{ ok?: boolean; activePage?: string }> {
    return setup.setDisplayPage(this.ctx, page);
  }

  startDisplayCalibration(): Promise<{ ok?: boolean; message?: string }> {
    return setup.startDisplayCalibration(this.ctx);
  }

  /** Arm the HDMI-kiosk touch-calibration wizard (`/api/v1/display/calibrate`). */
  startTouchCalibration(): Promise<setup.TouchCalibrationStart> {
    return setup.startTouchCalibration(this.ctx);
  }

  /** Poll the live HDMI-kiosk touch-calibration state. */
  getTouchCalibrationStatus(): Promise<setup.TouchCalibrationStatus> {
    return setup.getTouchCalibrationStatus(this.ctx);
  }

  applySetup(update: Record<string, unknown>): Promise<{ ok?: boolean }> {
    return setup.applySetup(this.ctx, update);
  }

  // ── Peripherals ────────────────────────────────────────────────

  getPeripherals(): Promise<PeripheralInfo[]> {
    return extras.getPeripherals(this.ctx);
  }

  scanPeripherals(): Promise<PeripheralInfo[]> {
    return extras.scanPeripherals(this.ctx);
  }

  // ── Fleet ──────────────────────────────────────────────────────

  getEnrollment(): Promise<MeshNetEnrollment> {
    return extras.getEnrollment(this.ctx);
  }

  getPeers(): Promise<NetworkPeer[]> {
    return extras.getPeers(this.ctx);
  }

  // ── Video ──────────────────────────────────────────────────────

  getVideoStatus(): Promise<VideoStatus | null> {
    return extras.getVideoStatus(this.ctx);
  }

  listCameras(): Promise<CameraListResponse> {
    return extras.listCameras(this.ctx);
  }

  /** The reconciled camera-management roster (`GET /api/video/roster`):
   * declared legs + discovered devices + live state, with per-camera
   * orientation / purpose / owner / state. */
  getCameraRoster(): Promise<RosterCamera[]> {
    return camera.getCameraRoster(this.ctx);
  }

  /** Persist the operator's declared camera leg list (`PUT /api/video/roster`).
   * The agent merges by owner + restarts the video pipeline. */
  setCameraRoster(cameras: CameraLegInput[]): Promise<void> {
    return camera.setCameraRoster(this.ctx, cameras);
  }

  switchCamera(
    role: "primary" | "secondary",
    devicePath: string,
  ): Promise<{ ok?: boolean; restarting?: boolean }> {
    return extras.switchCamera(this.ctx, role, devicePath);
  }

  getVideoConfig(): Promise<unknown | null> {
    return extras.getVideoConfig(this.ctx);
  }

  setVideoConfig(
    body: Partial<{
      bitrate_kbps: number;
      fec_k: number;
      fec_n: number;
      mcs: number;
      auto: boolean;
      tier_idx: number;
    }>,
  ): Promise<unknown | null> {
    return extras.setVideoConfig(this.ctx, body);
  }

  getVideoLatency(): Promise<unknown | null> {
    return extras.getVideoLatency(this.ctx);
  }

  getTime(): Promise<
    { time_ns: number; monotonic_ns: number; ntp_synced: boolean } | null
  > {
    return extras.getTime(this.ctx);
  }

  // ── Recording ──────────────────────────────────────────────────

  startRecording(): Promise<RecordingControlResponse> {
    return extras.startRecording(this.ctx);
  }

  stopRecording(): Promise<RecordingControlResponse> {
    return extras.stopRecording(this.ctx);
  }

  listRecordings(): Promise<RecordingListResponse> {
    return extras.listRecordings(this.ctx);
  }

  // ── Pairing ────────────────────────────────────────────────────

  getPairingInfo(): Promise<PairingInfo> {
    return extras.getPairingInfo(this.ctx);
  }

  claimLocally(userId: string): Promise<ClaimResponse> {
    return extras.claimLocally(this.ctx, userId);
  }

  unpairAgent(): Promise<CommandResult> {
    return extras.unpairAgent(this.ctx);
  }

  // ── MAVLink signing ────────────────────────────────────────────

  getSigningCapability(): Promise<SigningCapability> {
    return extras.getSigningCapability(this.ctx);
  }

  enrollSigningKey(keyHex: string, linkId: number): Promise<SigningEnrollResult> {
    return extras.enrollSigningKey(this.ctx, keyHex, linkId);
  }

  disableSigningOnFc(): Promise<{ success: boolean }> {
    return extras.disableSigningOnFc(this.ctx);
  }

  getSigningRequire(): Promise<{ require: boolean | null }> {
    return extras.getSigningRequire(this.ctx);
  }

  setSigningRequire(
    require: boolean,
  ): Promise<{ success: boolean; require: boolean }> {
    return extras.setSigningRequire(this.ctx, require);
  }

  getSigningCounters(): Promise<SigningCounters> {
    return extras.getSigningCounters(this.ctx);
  }

  getOtaStatus(): Promise<extras.OtaStatus> {
    return extras.getOtaStatus(this.ctx);
  }

  checkOtaUpdate(): Promise<{
    status?: string;
    version?: string | null;
    changelog?: string | null;
  }> {
    return extras.checkOtaUpdate(this.ctx);
  }

  installOtaUpdate(): Promise<{ status?: string; message?: string }> {
    return extras.installOtaUpdate(this.ctx);
  }

  restartAfterOta(): Promise<{ status?: string; message?: string }> {
    return extras.restartAfterOta(this.ctx);
  }
}
