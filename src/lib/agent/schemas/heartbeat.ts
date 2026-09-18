/**
 * @module AgentSchemas/Heartbeat
 * @description zod schemas for the ADOS Drone Agent heartbeat surfaces:
 * board identity, health, status, telemetry snapshot, service summaries,
 * resources, video, and the consolidated /api/status/full response.
 *
 * Schemas are permissive at the seam: unknown fields pass through, optional
 * fields are explicitly optional, and unions accept older legacy shapes the
 * agent has shipped over time.
 *
 * @license GPL-3.0-only
 */

import { z } from "zod";

import {
  NullableNumber,
  NullableString,
  NumberLike,
  OptionalNumberLike,
} from "./primitives";
import { AgentCapabilitiesRawSchema } from "./capabilities";

// ── Board + Health ──────────────────────────────────────

export const BoardInfoSchema = z
  .object({
    // All identity fields optional: a compute/workstation node (or any node
    // with no board sidecar) legitimately returns `board: {}`, so requiring
    // these would reject a valid boardless status and spam schema warnings.
    name: z.string().optional(),
    model: z.string().optional(),
    // A node with no board sidecar returns `board: {}`. These three used to be
    // non-optional `NumberLike`, which Zod invokes for an ABSENT key too, so a
    // boardless node parsed clean with tier 0 / 0 MB RAM / 0 cores — three
    // fabricated hardware facts that the capability inference then read.
    tier: OptionalNumberLike,
    ram_mb: OptionalNumberLike,
    cpu_cores: OptionalNumberLike,
    vendor: z.string().optional(),
    soc: z.string().optional(),
    arch: z.string().optional(),
    hw_video_codecs: z.array(z.string()).optional(),
  })
  .passthrough();

export const HealthInfoSchema = z
  .object({
    // Absent host metrics are absent, not 0%. A stock node ships the durable
    // store off, so the agent legitimately omits these.
    cpu_percent: OptionalNumberLike,
    memory_percent: OptionalNumberLike,
    disk_percent: OptionalNumberLike,
    temperature: NullableNumber,
    timestamp: z.string(),
  })
  .passthrough();

// ── Status (legacy /api/status) ─────────────────────────

export const AgentStatusSchema = z
  .object({
    version: z.string(),
    uptime_seconds: NumberLike,
    board: BoardInfoSchema.optional(),
    health: HealthInfoSchema,
    fc_connected: z.boolean(),
    fc_port: z.string(),
    fc_baud: NumberLike,
    // Gated MAVLink truth (transport-open vs decoded-heartbeat). Optional so
    // older agents validate cleanly; the render boundary prefers these over a
    // bare fc_connected when present.
    transport_open: z.boolean().optional(),
    mavlink_alive: z.boolean().optional(),
    heartbeat_age_s: NullableNumber.optional(),
    fc_source: z.string().optional(),
    // Diagnostic hint for a not-alive link ("none" | "msp_detected" |
    // "no_heartbeat"). Loose string here; narrowed at the render boundary.
    fc_link_hint: z.string().optional(),
    // FC protocol family the agent identified ("betaflight" | "inav" for an
    // MSP FC). Loose string here; the adapter selector narrows it.
    fc_variant: z.string().optional(),
    // Canonical FC firmware family ("ardupilot" | "px4" | "betaflight" |
    // "inav" | "unknown"). Unlike fc_variant it distinguishes the two MAVLink
    // stacks (ArduPilot vs PX4). Optional so older agents validate cleanly.
    fc_firmware: z.string().optional(),
    // Kernel release + radio-module source + install-health summary.
    // Optional so older agents that omit them validate cleanly; the
    // enum-like fields stay loose strings here and are narrowed at the
    // render boundary.
    kernel_release: z.string().optional(),
    wfb_module_source: z.string().optional(),
    install_status: z.string().optional(),
    install_version: z.string().optional(),
    failed_steps: z.array(z.string()).optional(),
  })
  .passthrough();

export type AgentStatusValidated = z.infer<typeof AgentStatusSchema>;

// ── Version + capabilities ──────────────────────────────

export const AgentVersionInfoSchema = z
  .object({
    api_version: z.string(),
    agent_version: z.string(),
    capabilities: z.array(z.string()),
  })
  .passthrough();

// ── System resources ────────────────────────────────────

export const SystemResourcesRawSchema = z
  .object({
    cpu_percent: NumberLike.optional(),
    memory_percent: NumberLike.optional(),
    memory_used_mb: NumberLike.optional(),
    memory_total_mb: NumberLike.optional(),
    memory_available_mb: NumberLike.optional(),
    memory_cache_mb: NumberLike.optional(),
    swap_total_mb: NumberLike.optional(),
    swap_used_mb: NumberLike.optional(),
    swap_percent: NumberLike.optional(),
    disk_percent: NumberLike.optional(),
    disk_used_gb: NumberLike.optional(),
    disk_total_gb: NumberLike.optional(),
    temperature: NullableNumber.optional(),
    temperatures: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

// ── Telemetry snapshot ──────────────────────────────────

export const TelemetrySnapshotSchema = z
  .object({
    lat: NumberLike,
    lon: NumberLike,
    alt: NumberLike,
    relative_alt: NumberLike,
    heading: NumberLike,
    groundspeed: NumberLike,
    airspeed: NumberLike,
    roll: NumberLike,
    pitch: NumberLike,
    yaw: NumberLike,
    battery_voltage: NumberLike,
    battery_current: NumberLike,
    battery_remaining: NumberLike,
    gps_fix: NumberLike,
    satellites: NumberLike,
    mode: z.string(),
    armed: z.boolean(),
  })
  .passthrough();

// ── Services ────────────────────────────────────────────

export const ServiceSummarySchema = z
  .object({
    name: z.string(),
    state: z.string().optional(),
    status: z.string().optional(),
    pid: z.union([z.number(), z.null()]).optional(),
    cpu_percent: NumberLike.optional(),
    cpuPercent: NumberLike.optional(),
    memory_mb: NumberLike.optional(),
    memoryMb: NumberLike.optional(),
    uptime_seconds: NumberLike.optional(),
    uptimeSeconds: NumberLike.optional(),
    last_transition: NumberLike.optional(),
    task_done: z.boolean().optional(),
    category: z.enum(["core", "hardware", "suite", "ondemand"]).optional(),
  })
  .passthrough();

export const ServicesResponseSchema = z.union([
  z.array(ServiceSummarySchema),
  z.object({ services: z.array(ServiceSummarySchema) }).passthrough(),
]);

// ── Video status ────────────────────────────────────────

export const VideoStatusSchema = z
  .object({
    state: z.enum([
      "not_initialized",
      "stopped",
      "starting",
      "running",
      "error",
    ]),
    whep_url: NullableString,
    encoder: NullableString,
    cameras: z
      .object({
        cameras: z.array(
          z
            .object({
              name: z.string(),
              type: z.string(),
              device_path: z.string(),
              hardware_role: z.string(),
            })
            .passthrough(),
        ),
        assignments: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
    mediamtx: z
      .object({
        running: z.boolean(),
        webrtc_port: NumberLike,
      })
      .passthrough(),
    dependencies: z
      .record(
        z.string(),
        z
          .object({
            found: z.boolean(),
            path: NullableString.optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

// ── Consolidated /api/status/full ───────────────────────

const FullStatusServiceSchema = z
  .object({
    name: z.string(),
    state: z.string(),
    task_done: z.boolean().optional(),
    uptimeSeconds: NumberLike.optional(),
  })
  .passthrough();

/**
 * `/api/status/full`'s resource block.
 *
 * `cpu_percent`, `memory_percent` and `disk_percent` are `OptionalNumberLike`,
 * NOT the bare `NumberLike` they used to be. The agent now emits an explicit
 * `null` for a reading it could not take, rather than the `0.0` it used to
 * fabricate — and a required `NumberLike` here would have coerced that null
 * straight back to 0, re-creating the same lie one layer further along. An
 * idle CPU and an unreadable CPU must not render identically.
 */
const FullStatusResourcesSchema = z
  .object({
    cpu_percent: OptionalNumberLike,
    memory_percent: OptionalNumberLike,
    memory_available_mb: OptionalNumberLike,
    memory_cache_mb: OptionalNumberLike,
    swap_total_mb: OptionalNumberLike,
    swap_used_mb: OptionalNumberLike,
    swap_percent: OptionalNumberLike,
    disk_percent: OptionalNumberLike,
    temperature: NullableNumber,
  })
  .passthrough();

const FullStatusVideoSchema = z
  .object({
    state: z.string(),
    whep_url: NullableString,
  })
  .passthrough();

export const FullStatusResponseSchema = z
  .object({
    version: z.string(),
    uptime_seconds: NumberLike,
    board: BoardInfoSchema.optional(),
    health: HealthInfoSchema,
    fc_connected: z.boolean(),
    fc_port: z.string(),
    fc_baud: NumberLike,
    // Gated MAVLink truth. The native front emits these camelCase on the wire;
    // getFullStatus normalises to these snake-case fields. The schema passes
    // unknown (camelCase) keys through, so the normaliser can read them.
    transport_open: z.boolean().optional(),
    mavlink_alive: z.boolean().optional(),
    heartbeat_age_s: NullableNumber.optional(),
    fc_source: z.string().optional(),
    fc_link_hint: z.string().optional(),
    fc_variant: z.string().optional(),
    fc_firmware: z.string().optional(),
    services: z.array(FullStatusServiceSchema).optional(),
    resources: FullStatusResourcesSchema.optional(),
    video: FullStatusVideoSchema.optional(),
    telemetry: z.record(z.string(), z.unknown()).optional(),
    capabilities: AgentCapabilitiesRawSchema.optional(),
  })
  .passthrough();

export type FullStatusResponseValidated = z.infer<
  typeof FullStatusResponseSchema
>;

// ── MAVLink ports + ping ────────────────────────────────

export const MavlinkPortsResponseSchema = z
  .object({
    ports: z.array(
      z
        .object({
          path: z.string(),
          description: z.string().optional().default(""),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const PingResponseSchema = z
  .object({
    pong: NumberLike,
  })
  .passthrough();
