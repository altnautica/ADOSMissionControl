/**
 * @module convex/lib/heartbeatStatusFields
 * @description Payload coercion for the heartbeat's service list, command ack
 * and the snake_case radio and CRSF blocks, reshaped into the camelCase the
 * `pushStatus` validator declares and filtered to its declared keys.
 *
 * The agent's heartbeat body is `HeartbeatPayload`, generated from the agent's
 * schema; its `radio` and `crsf` blocks (`RadioBlock`, `CrsfBlock`) arrive in
 * snake_case and its `services` rows in camelCase.
 *
 * @license GPL-3.0-only
 */

import { snakeToCamelObject } from "../heartbeatCasing";
import type { HeartbeatPayload } from "./agentHeartbeat.generated";
import { pushStatusArgs } from "./pushStatusArgs";
import { booleanField, declaredKeys, numberField, stringField } from "./heartbeatPrimitives";

export interface ServiceStatusPayload {
  name: string;
  status: string;
  cpuPercent?: number;
  memoryMb?: number;
  uptimeSeconds?: number;
  pid?: number;
  category?: string;
}

export function serviceListField(
  body: Record<string, unknown>,
  key: keyof HeartbeatPayload,
): ServiceStatusPayload[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  const services: ServiceStatusPayload[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name = stringField(row, "name");
    const status = stringField(row, "status");
    if (!name || !status) continue;
    services.push({
      name,
      status,
      cpuPercent: numberField(row, "cpuPercent"),
      memoryMb: numberField(row, "memoryMb"),
      uptimeSeconds: numberField(row, "uptimeSeconds"),
      pid: numberField(row, "pid"),
      category: stringField(row, "category"),
    });
  }
  return services;
}

/** A command ack's terminal status, or null when the agent stated neither
 * `completed` nor `failed` (missing, `error`, `timeout`, ...). */
export function commandStatusField(
  value: string | undefined,
): "completed" | "failed" | null {
  return value === "completed" || value === "failed" ? value : null;
}

export interface RadioPayload {
  state: string;
  iface: string | null;
  driver: string | null;
  channel: number | null;
  freqMhz: number | null;
  bandwidthMhz: number;
  txPowerDbm: number | null;
  txPowerMaxDbm: number;
  topology: string;
  rssiDbm: number | null;
  bitrateKbps: number | null;
  fecRecovered: number;
  fecLost: number;
  packetsLost: number;
  homeChannel: number | null;
  band: string | null;
  regDomain: string | null;
  regPosture: string | null;
  pinnedRegion: string | null;
  regVerified: boolean | null;
  monitorActive: boolean | null;
  txActive: boolean | null;
  peerLink: string | null;
  hopState: string | null;
  snrDb: number | null;
  noiseDbm: number | null;
  lossPercent: number | null;
  mcsIndex: number | null;
  rxSilentSeconds: number | null;
  txVideoStalled: boolean | null;
  txVideoStallKills: number | null;
  txVideoRecvqBytes: number | null;
  acquireState: string | null;
  channelLocked: boolean | null;
  // Null means "no verdict" — distinct from false, which asserts the transmit
  // path was proven. Optional: older agents omit the key entirely.
  rfUnverified?: boolean | null;
  reacquireKills: number | null;
  rxZombieKills: number | null;
  validRxPacketsPerS: number | null;
  adapterChipset?: string | null;
  adapterInjectionOk?: boolean | null;
  adapterUsbDegraded?: boolean | null;
  adapterUsbSpeedMbps?: number | null;
  phyMuted?: boolean | null;
  fecK?: number | null;
  fecN?: number | null;
  linkPreset?: string | null;
  adaptiveBitrateEnabled?: boolean | null;
  recommendedTierIdx?: number | null;
  recommendedTierName?: string | null;
  recommendedBitrateKbps?: number | null;
  txZombieKills?: number | null;
  txBytesPerS?: number | null;
  restartCount?: number | null;
  paired?: boolean;
  pairedWithDeviceId?: string | null;
  pairedAt?: string | null;
  publicKeyFingerprint?: string | null;
  autoPairEnabled?: boolean | null;
  pairRearm?: { cause: string | null; at: number; episodes: number; active: boolean } | null;
  fleetApply?: {
    outcome: string;
    fleetId: number | null;
    fleetSlot: number | null;
    sinceMs: number | null;
    atMs: number | null;
  } | null;
}

export const RADIO_KEYS = declaredKeys(pushStatusArgs.radio);
export const CRSF_KEYS = declaredKeys(pushStatusArgs.crsf);

/**
 * Translate the agent's snake_case radio block into the camelCase shape the
 * validator and schema expect, and DROP any key the validator does not
 * declare.
 *
 * The filter is the load-bearing part. This used to forward every remapped
 * key verbatim into a strict `v.object()`, so one undeclared key the agent
 * added — or a `radio: {}` missing a required field — threw
 * `ArgumentValidationError` inside `ctx.runMutation` and 500'd the WHOLE 5 s
 * heartbeat: `lastSeen` stopped advancing and the aircraft read offline for a
 * reason invisible in the UI. That already happened once (see the
 * `adapterUsbSpeedMbps` note in `cmdDroneStatus.ts`), and the comment here
 * asserted the opposite safety property while doing nothing to provide it.
 *
 * A block that still cannot satisfy the validator is dropped entirely rather
 * than failing the heartbeat — one missing telemetry block is a far better
 * outcome than an aircraft that reads offline.
 */
export function radioField(
  body: Record<string, unknown>,
  key: keyof HeartbeatPayload,
): RadioPayload | undefined {
  const raw = body[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const remapped: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(raw as Record<string, unknown>)) {
    const camelKey = k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    if (RADIO_KEYS && !RADIO_KEYS.has(camelKey)) continue;
    // The fleet-apply view nests its own snake_case keys (`fleet_slot`).
    remapped[camelKey] = camelKey === "fleetApply" && value ? snakeToCamelObject(value) ?? null : value;
  }
  // The validator's 14 non-optional fields are nullable, so an agent that
  // omits one gets an explicit null rather than an invalid block.
  for (const required of RADIO_REQUIRED_FIELDS) {
    if (!(required in remapped)) remapped[required] = null;
  }
  if (typeof remapped.state !== "string") remapped.state = "unknown";
  return remapped as unknown as RadioPayload;
}

/**
 * The radio validator's non-optional fields. Every one is `v.union(T,
 * v.null())`, so a null satisfies it; `state` is a bare `v.string()` and gets
 * an explicit "unknown" instead.
 */
export const RADIO_REQUIRED_FIELDS = [
  "iface", "driver", "channel", "freqMhz", "bandwidthMhz", "txPowerDbm",
  "txPowerMaxDbm", "topology", "rssiDbm", "bitrateKbps", "fecRecovered",
  "fecLost", "packetsLost",
] as const;

export interface CrsfPayload {
  v?: number | null;
  state?: string | null;
  rssiDbm?: number | null;
  lqUplink?: number | null;
  lqDownlink?: number | null;
  snrDb?: number | null;
  band?: string | null;
  packetRateHz?: number | null;
  txPowerMw?: number | null;
  txFramesPerS?: number | null;
  rxFramesPerS?: number | null;
  rfUnverified?: boolean | null;
  mode?: string | null;
  channelSource?: string | null;
  relayRole?: string | null;
  fcCommandDownGated?: boolean | null;
}

/**
 * Translate the agent's snake_case CRSF/ExpressLRS control-lane block into the
 * camelCase shape the validator expects, dropping any key the validator does
 * not declare.
 *
 * Same hazard as {@link radioField}: forwarding an undeclared key into a
 * strict `v.object()` fails the WHOLE heartbeat, not just this block. The old
 * comment claimed a bad block "can never fail the strict v.object()
 * validator" — nothing enforced that.
 */
export function crsfField(
  body: Record<string, unknown>,
  key: keyof HeartbeatPayload,
): CrsfPayload | undefined {
  const remapped = snakeToCamelObject(body[key]) as Record<string, unknown> | undefined;
  if (!remapped) return undefined;
  if (!CRSF_KEYS) return remapped as unknown as CrsfPayload;
  const filtered: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(remapped)) {
    if (CRSF_KEYS.has(k)) filtered[k] = value;
  }
  return filtered as unknown as CrsfPayload;
}

export function commandResultField(
  value: unknown,
): { success: boolean; message: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const success = booleanField(row, "success");
  const message = stringField(row, "message");
  if (success === undefined || !message) return undefined;
  return { success, message };
}
