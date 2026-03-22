/**
 * @module AgentTypes
 * @description TypeScript types for the ADOS Drone Agent REST API.
 * @license GPL-3.0-only
 */

export interface BoardInfo {
  name: string;
  model: string;
  tier: number;
  ram_mb: number;
  cpu_cores: number;
  vendor: string;
  soc: string;
  arch: string;
  hw_video_codecs: string[];
}

export interface HealthInfo {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  temperature: number | null;
  timestamp: string;
}

export interface AgentStatus {
  version: string;
  uptime_seconds: number;
  board: BoardInfo;
  health: HealthInfo;
  fc_connected: boolean;
  fc_port: string;
  fc_baud: number;
}

export interface ServiceInfo {
  name: string;
  status: "running" | "stopped" | "error" | "degraded" | "starting" | "circuit_open";
  pid: number | null;
  cpu_percent: number;
  memory_mb: number;
  uptime_seconds: number;
  category?: "core" | "hardware" | "suite" | "ondemand";
}

export interface SystemResources {
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  temperature: number | null;
}

export interface TelemetrySnapshot {
  lat: number;
  lon: number;
  alt: number;
  relative_alt: number;
  heading: number;
  groundspeed: number;
  airspeed: number;
  roll: number;
  pitch: number;
  yaw: number;
  battery_voltage: number;
  battery_current: number;
  battery_remaining: number;
  gps_fix: number;
  satellites: number;
  mode: string;
  armed: boolean;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  service: string;
  message: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export type PeripheralCategory = "sensor" | "camera" | "video" | "gimbal" | "compute";

export interface PeripheralInfo {
  name: string;
  type: string;
  category: PeripheralCategory;
  bus: string;
  address: string;
  rate_hz: number;
  status: "ok" | "warning" | "error" | "offline";
  last_reading: string;
}

export interface ScriptInfo {
  id: string;
  name: string;
  content: string;
  suite?: string;
  lastModified: string;
}

export interface ScriptRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SuiteInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  sensorsRequired: string[];
  tierRequired: number;
  version: string;
  installed: boolean;
  active: boolean;
  category: "security" | "mapping" | "agriculture" | "logistics" | "rescue" | "inspection";
}

export interface DroneNetEnrollment {
  enrolled: boolean;
  droneId?: string;
  fleetName?: string;
  tier?: number;
  enrolledSince?: string;
}

export interface NetworkPeer {
  id: string;
  name: string;
  signal_dbm: number;
  last_seen: string;
  battery_percent: number;
  distance_m: number;
  tier: number;
  link_type: string;
}

// ── Pairing ─────────────────────────────────────────────

export interface PairingInfo {
  device_id: string;
  name: string;
  version: string;
  board: string;
  paired: boolean;
  pairing_code?: string;
  owner_id?: string;
  paired_at?: number;
  mdns_host: string;
}

export interface ClaimResponse {
  api_key: string;
  device_id: string;
  name: string;
  mdns_host: string;
}
