/**
 * Core DroneProtocol members: connection, links, commands, field operations and manual control.
 *
 * @module protocol/types/protocol/base
 */

import type { Transport } from '../transport';
import type { UnifiedFlightMode } from '../enums';
import type { VehicleInfo, CommandResult } from '../core';
import type { FenceElement, RallyPointItem } from '../mission';

/** Public link info exposed to the UI for multi-link displays. */
export interface LinkInfo {
  id: string;
  type: Transport['type'];
  label: string;
  isConnected: boolean;
  connectedAt: number;
  lastByteAt: number;
  isPrimary: boolean;
}

/** One entry from a MAVLink FTP ListDirectory response. */
export interface FtpDirEntry {
  name: string;
  /** File size in bytes (0 for directories). */
  size: number;
  isDir: boolean;
}

/** Options for {@link DroneProtocol.guidedGoto}. */
export interface GuidedGotoOptions {
  /**
   * Switch the vehicle into its guided mode as part of the reposition
   * (MAV_DO_REPOSITION_FLAGS_CHANGE_MODE). Defaults to true.
   */
  changeMode?: boolean;
}

/** Pending-command view returned by {@link DroneProtocol.getCommandQueueSnapshot}. */
export interface CommandQueueSnapshot {
  pendingCount: number;
  entries: { ticket: number; command: number; retryCount: number; sentAt: number }[];
}

/** Core members of {@link DroneProtocol}. */
export interface DroneProtocolBase {
  readonly protocolName: string;

  // ── Connection ──────────────────────────────────────────
  connect(transport: Transport): Promise<VehicleInfo>;
  disconnect(): Promise<void>;
  readonly isConnected: boolean;
  /**
   * Fires once when the protocol loses its last link (or is disconnected).
   * The protocol, not any one transport, is the source of truth for whether
   * a multi-link drone is still reachable. Returns an unsubscribe function.
   */
  onDisconnect?(cb: () => void): () => void;

  // ── Multi-Link (optional) ───────────────────────────────
  /** Add an additional transport as a link. Validates sysid match. */
  addLink?(transport: Transport): Promise<{ ok: true; linkId: string } | { ok: false; error: string }>;
  /** Remove a link by id. If it's the last link, the protocol disconnects. */
  removeLink?(linkId: string): Promise<void>;
  /** Information about all active links for this drone. */
  readonly linkInfo?: LinkInfo[];
  /** The link outbound frames go through (prefers one that can command). */
  readonly commandTransport?: Transport | null;

  // ── Commands ────────────────────────────────────────────
  arm(): Promise<CommandResult>;
  disarm(): Promise<CommandResult>;
  setFlightMode(mode: UnifiedFlightMode): Promise<CommandResult>;
  returnToLaunch(): Promise<CommandResult>;
  /** Land. `at` is sent with the command, but ArduPilot ignores it and lands
   *  in place; a surface that lands somewhere else repositions first and
   *  calls this once the vehicle is holding over the point. */
  land(at?: { lat: number; lon: number }): Promise<CommandResult>;
  takeoff(altitude: number): Promise<CommandResult>;
  /**
   * Flight termination. Irreversible in flight. `confirmed` must carry a real
   * operator confirmation; the protocol layer refuses without it rather than
   * guessing that a bare click meant it.
   */
  killSwitch(confirmed: boolean): Promise<CommandResult>;
  /**
   * Reposition to a point (MAV_CMD_DO_REPOSITION). By default the vehicle is
   * also switched into its guided mode; `changeMode: false` sends the
   * reposition without that flag, so a stream of updates never pulls a vehicle
   * back out of a mode the pilot or a failsafe chose.
   */
  guidedGoto(lat: number, lon: number, alt: number, options?: GuidedGotoOptions): Promise<CommandResult>;
  pauseMission(): Promise<CommandResult>;
  resumeMission(): Promise<CommandResult>;
  clearMission(): Promise<CommandResult>;
  commitParamsToFlash(): Promise<CommandResult>;

  // ── Field Operations ──────────────────────────────────────
  setHome(useCurrent: boolean, lat?: number, lon?: number, alt?: number): Promise<CommandResult>;
  changeSpeed(speedType: number, speed: number): Promise<CommandResult>;
  setYaw(angle: number, speed: number, direction: number, relative: boolean): Promise<CommandResult>;
  setGeoFenceEnabled(enabled: boolean): Promise<CommandResult>;
  setServo(servoNumber: number, pwm: number): Promise<CommandResult>;
  cameraTrigger(): Promise<CommandResult>;
  setGimbalAngle(pitch: number, roll: number, yaw: number): Promise<CommandResult>;
  /**
   * Ask the FC for its pre-arm verdict. Over MAVLink, success means the FC
   * accepted MAV_CMD_RUN_PREARM_CHECKS and ran them; any failures arrive
   * afterwards as STATUSTEXT, and the SYS_STATUS pre-arm bit carries the
   * verdict. Over MSP the arming-disable word is read directly, so success
   * means no blocker is set and a failure message names the blockers.
   */
  doPreArmCheck(): Promise<CommandResult>;

  // ── Fence Operations ──────────────────────────────────────
  /**
   * Upload the geofence as a fence-type mission (mission_type = fence). An
   * empty element list uploads a count of 0, which clears the vehicle's fence.
   */
  uploadFenceMission?(elements: FenceElement[]): Promise<CommandResult>;
  /** Download the geofence as a fence-type mission and reassemble the model. */
  downloadFenceMission?(): Promise<FenceElement[]>;

  // ── Rally Point Operations ───────────────────────────────
  uploadRallyPoints?(points: RallyPointItem[]): Promise<CommandResult>;
  /** Each point with the MAV_FRAME its altitude was stored in. */
  downloadRallyPoints?(): Promise<RallyPointItem[]>;

  // ── Fence Enable ─────────────────────────────────────────
  enableFence?(enable: boolean): Promise<CommandResult>;

  // ── Landing / Relay / Video / RX Pair ───────────────────
  doLandStart?(): Promise<CommandResult>;
  controlVideo?(params: { cameraId: number; transmission: number; channel: number; recording: number }): Promise<CommandResult>;
  setRelay?(relayNum: number, on: boolean): Promise<CommandResult>;
  startRxPair?(spektrum: number): Promise<CommandResult>;

  // ── Camera/Gimbal ─────────────────────────────────────────
  setGimbalMode?(mode: number): Promise<CommandResult>;
  setGimbalROI?(lat: number, lon: number, alt: number): Promise<CommandResult>;
  setRoiLocation?(lat: number, lon: number, alt: number): Promise<CommandResult>;
  clearRoi?(): Promise<CommandResult>;
  /**
   * One still image (MAV_CMD_IMAGE_START_CAPTURE), sent to the camera that
   * advertised itself in CAMERA_INFORMATION, else to the autopilot.
   */
  imageStartCapture?(): Promise<CommandResult>;
  /** One zoom step in (1) or out (-1) (MAV_CMD_SET_CAMERA_ZOOM: a continuous-zoom pulse, then rate 0), same target. */
  setCameraZoom?(step: 1 | -1): Promise<CommandResult>;

  // ── Orbit ────────────────────────────────────────────────
  orbit?(radius: number, velocity: number, yawBehavior: number, lat: number, lon: number, alt: number): Promise<CommandResult>;

  // ── EKF ──────────────────────────────────────────────────
  setEkfOrigin?(lat: number, lon: number, alt: number): Promise<CommandResult>;
  /**
   * Switch the active EKF source set on the flight controller at runtime.
   *
   * ArduPilot: fires MAV_CMD_SET_EKF_SOURCE_SET (42007) and resolves on the
   * COMMAND_ACK or 1 s timeout.
   *
   * PX4 has no runtime equivalent. Switching source sets requires a
   * parameter update plus an EKF restart. Implementations should warn and
   * resolve with `{ ok: false, reason: "px4-not-supported" }` rather than
   * throwing, so the caller can render the right UX.
   */
  setEkfSourceSet(sourceSet: 1 | 2 | 3): Promise<{ ok: true } | { ok: false; reason: "px4-not-supported" | "no-ack" | "rejected" }>;

  // ── Manual Control ──────────────────────────────────────
  /**
   * Send one normalized stick frame at up to 50 Hz. Fire-and-forget (no ACK).
   *
   * `roll`, `pitch`, and `yaw` are -1..1 with 0 at center. `throttle` is a
   * deliberately different range, 0..1 with 0 at idle: on an MSP flight
   * controller the center of a bipolar range is half throttle, so a throttle
   * that shares the stick scale idles the aircraft at half power.
   */
  sendManualControl(
    roll: number,
    pitch: number,
    throttle: number,
    yaw: number,
    buttons: number,
  ): void;

  /**
   * Why this link cannot carry stick frames, in operator-readable terms, or
   * null when it can.
   *
   * `sendManualControl` is fire-and-forget, so a link that refuses every frame
   * refuses them silently. This is how that refusal reaches a surface. Absent
   * on links that have no such condition.
   */
  getManualControlBlockedReason?(): string | null;
}
