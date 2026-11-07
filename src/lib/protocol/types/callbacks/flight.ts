/**
 * Flight, link and status telemetry callbacks.
 *
 * Shapes reuse the store telemetry interfaces where they match, so
 * protocol → store bridging is a plain assignment.
 *
 * @module protocol/types/callbacks/flight
 */

import type { UnifiedFlightMode } from '../enums';
import type { VehicleInfo, ParameterValue } from '../core';
import type { AttitudeData, BatteryData, GpsData, PositionData, RadioData, RcData, SysStatusData, VfrData } from '../../../types/telemetry';

export type AttitudeCallback = (data: AttitudeData) => void;

export type PositionCallback = (data: PositionData) => void;

export type BatteryCallback = (data: BatteryData & {
  /**
   * Battery instance (BATTERY_STATUS.id). 0 is the primary pack; further
   * monitors (a second pack, an avionics rail) report their own ids.
   */
  id: number;
}) => void;

export type GpsCallback = (data: GpsData) => void;

export type VfrCallback = (data: VfrData) => void;

export type RcCallback = (data: RcData) => void;

export type StatusTextCallback = (data: {
  severity: number;
  text: string;
}) => void;

/** MAVLink EVENT (msg 410) — the PX4 structured-events successor to STATUSTEXT.
 * `id` = (componentId << 24) | subId, keying the events metadata; `logLevels`
 * is a 4-bit MSB internal + 4-bit LSB external level; `arguments` are packed
 * bytes decoded per the event's metadata argument types. */
export type EventCallback = (data: {
  id: number;
  eventTimeBootMs: number;
  sequence: number;
  destinationComponent: number;
  destinationSystem: number;
  logLevels: number;
  arguments: Uint8Array;
}) => void;

export type HeartbeatCallback = (data: {
  armed: boolean;
  mode: UnifiedFlightMode;
  systemStatus: number;
  vehicleInfo: VehicleInfo;
  /** The raw HEARTBEAT custom_mode (MAVLink links only), for numeric mode checks. */
  customMode?: number;
}) => void;

export type ParameterCallback = (data: ParameterValue) => void;

export type SerialDataCallback = (data: { device: number; data: Uint8Array }) => void;

export type SysStatusCallback = (data: SysStatusData) => void;

export type RadioCallback = (data: RadioData) => void;

export type MissionProgressCallback = (data: {
  currentSeq: number;
  reachedSeq?: number;
  /** MISSION_CURRENT extension fields, present when the FC sends them. */
  total?: number;
  /** MISSION_STATE enum (0 unknown, 1 no mission, 2 not started, 3 active, 4 paused, 5 complete). */
  missionState?: number;
  missionId?: number;
}) => void;
