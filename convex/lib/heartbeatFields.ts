/**
 * @module convex/lib/heartbeatFields
 * @description Payload coercion for the agent-facing HTTP routes.
 *
 * These are pure functions over a parsed JSON body: type-check a key,
 * bound a string, reshape a snake_case block into the camelCase the
 * `pushStatus` validator declares. They have no Convex dependency beyond
 * reading `pushStatusArgs` for its declared key sets.
 *
 * They live here rather than inside `convex/http.ts` for one reason: a
 * Convex `httpAction` cannot be invoked from a unit test, so while these
 * sat in that file the only "tests" covering them read the source with
 * `readFileSync` and asserted on substrings — which pins the spelling of
 * an identifier and proves nothing about behaviour. Every one of the
 * CRITICAL defects in this layer survived a green suite
 * for exactly that reason. As pure exports they are directly callable,
 * and it takes `http.ts` well down from its 1334 lines.
 *
 * @license GPL-3.0-only
 */

import { snakeToCamelObject } from "../heartbeatCasing";
import { pushStatusArgs } from "../cmdDroneStatus";

/** Shared JSON response header, mirroring the one in `http.ts`. */
export const jsonHeaders = { "Content-Type": "application/json" };

export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * A string field with a hard length cap, or a 400 `Response` when the caller
 * exceeded it.
 *
 * `stringField` type-checks but never length-checks, and the device routes
 * write ~140 such fields straight to the DB with the 512 KB body cap as the
 * only bound — per request, on a route devices call every 5 s. Anything
 * persisted AND rendered gets an explicit cap.
 */
export function boundedField(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined | Response {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  if (value.length > maxLength) {
    return new Response(
      JSON.stringify({ error: `${key} exceeds ${maxLength} characters` }),
      { status: 400, headers: jsonHeaders },
    );
  }
  return value;
}

export function numberField(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" ? value : undefined;
}

export function booleanField(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

export function numberArrayField(
  body: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "number") ? value : undefined;
}

export function stringArrayField(
  body: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

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
  key: string,
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

export function commandStatusField(value: string | undefined): "completed" | "failed" {
  return value === "failed" ? "failed" : "completed";
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
}

export function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number") return value;
  return undefined;
}

export function nullableBoolean(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  return undefined;
}

export function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

/**
 * The keys an object validator declares, or null when it is not an object
 * validator. Read from the validator at runtime so a filter built on it can
 * never drift from the schema it guards.
 */
export function declaredKeys(validator: unknown): Set<string> | null {
  const fields = (validator as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields || typeof fields !== "object") return null;
  return new Set(Object.keys(fields));
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
  key: string,
): RadioPayload | undefined {
  const raw = body[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const remapped: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(raw as Record<string, unknown>)) {
    const camelKey = k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    if (RADIO_KEYS && !RADIO_KEYS.has(camelKey)) continue;
    remapped[camelKey] = value;
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
  key: string,
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

export interface ManualConnectionUrlsPayload {
  mavlinkTcp?: string | null;
  mavlinkWs?: string | null;
  mavlinkWsAuthenticated?: string | null;
  videoViewer?: string | null;
  videoWhep?: string | null;
}

// Build the typed manual-connection-URLs block from the agent body. Each
// member is forwarded only when it is a string or explicit null so the
// strict pushStatus validator never rejects a malformed entry and fails the
// whole heartbeat. Returns undefined when the agent omits the block.
export function manualConnectionUrlsField(
  body: Record<string, unknown>,
): ManualConnectionUrlsPayload | undefined {
  const raw = body.manualConnectionUrls;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const out: ManualConnectionUrlsPayload = {};
  const mavlinkTcp = nullableString(row.mavlinkTcp);
  const mavlinkWs = nullableString(row.mavlinkWs);
  const mavlinkWsAuthenticated = nullableString(row.mavlinkWsAuthenticated);
  const videoViewer = nullableString(row.videoViewer);
  const videoWhep = nullableString(row.videoWhep);
  if (mavlinkTcp !== undefined) out.mavlinkTcp = mavlinkTcp;
  if (mavlinkWs !== undefined) out.mavlinkWs = mavlinkWs;
  if (mavlinkWsAuthenticated !== undefined)
    out.mavlinkWsAuthenticated = mavlinkWsAuthenticated;
  if (videoViewer !== undefined) out.videoViewer = videoViewer;
  if (videoWhep !== undefined) out.videoWhep = videoWhep;
  return out;
}

export interface PluginInventoryEntry {
  plugin_id: string;
  version?: string | null;
  status?: string | null;
}

// Build the plugin-inventory array, dropping any entry that lacks a string
// plugin_id so the strict pushStatus validator accepts the whole block.
// Returns undefined when the agent omits the field.
export function pluginInventoryField(
  body: Record<string, unknown>,
): PluginInventoryEntry[] | undefined {
  const raw = body.pluginInventory;
  if (!Array.isArray(raw)) return undefined;
  const out: PluginInventoryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const pluginId = stringField(row, "plugin_id");
    if (!pluginId) continue;
    const entry: PluginInventoryEntry = { plugin_id: pluginId };
    const version = nullableString(row.version);
    const status = nullableString(row.status);
    if (version !== undefined) entry.version = version;
    if (status !== undefined) entry.status = status;
    out.push(entry);
  }
  return out;
}

export interface PeripheralStateEntry {
  id: string;
  connected: boolean;
  last_seen?: number | null;
}

// Build the compact per-peripheral connection-state array (drives the
// connected/disconnected dot on the drone card). Drops any entry missing a
// string id or a boolean connected flag so the strict validator accepts the
// block. Returns undefined when the agent omits the field.
export function peripheralStatesField(
  body: Record<string, unknown>,
): PeripheralStateEntry[] | undefined {
  const raw = body.peripheralStates;
  if (!Array.isArray(raw)) return undefined;
  const out: PeripheralStateEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = stringField(row, "id");
    const connected = booleanField(row, "connected");
    if (!id || connected === undefined) continue;
    const entry: PeripheralStateEntry = { id, connected };
    const lastSeen = nullableNumber(row.last_seen);
    if (lastSeen !== undefined) entry.last_seen = lastSeen;
    out.push(entry);
  }
  return out;
}

export interface ComputeSlaveEntry {
  nodeId: string;
  accelerators: string[];
  workersIdle: number;
  queueDepth: number;
}

// Build the compute cluster's slave list, forwarding only well-formed entries
// and coercing each field to the validator-accepted shape so a malformed agent
// payload cannot fail the whole heartbeat. An entry without a node id is
// dropped; the numeric/array fields default so the strict inner validator
// (every field required) never throws. Returns undefined when absent.
export function computeClusterSlavesField(
  body: Record<string, unknown>,
): ComputeSlaveEntry[] | undefined {
  const raw = body.computeClusterSlaves;
  if (!Array.isArray(raw)) return undefined;
  const out: ComputeSlaveEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    // The heartbeat producer serializes slave entries camelCase already
    // (nodeId / workersIdle / queueDepth), so this generic snake->camel remap is
    // a defensive no-op on the live wire — it also accepts the snake_case
    // cluster-registration shape, coercing either to the camelCase the strict
    // inner validator expects.
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      const camelKey = k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
      row[camelKey] = v;
    }
    const nodeId = stringField(row, "nodeId");
    if (!nodeId) continue;
    out.push({
      nodeId,
      accelerators: stringArrayField(row, "accelerators") ?? [],
      workersIdle: numberField(row, "workersIdle") ?? 0,
      queueDepth: numberField(row, "queueDepth") ?? 0,
    });
  }
  return out;
}

export interface LinkedPeerEntry {
  deviceId: string;
  role?: string | null;
  channel?: number | null;
  rssiDbm?: number | null;
  seenAtUnix?: number | null;
}

// Build the linkedPeers[] list a ground station relays. The OSS-twin
// /agent/status route PICKS fields one by one, so this must be forwarded here
// or the mutation never receives it. Entries arrive camelCase already (the
// heartbeat producers emit deviceId/role/channel/rssiDbm/seenAtUnix); an entry
// with no device id, or a non-object, is DROPPED rather than failing the whole
// heartbeat, and each field is coerced to the optional-nullable shape the
// strict inner validator declares. Returns undefined when the agent omits it.
export function linkedPeersField(
  body: Record<string, unknown>,
): LinkedPeerEntry[] | undefined {
  const raw = body.linkedPeers;
  if (!Array.isArray(raw)) return undefined;
  const out: LinkedPeerEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const deviceId = stringField(row, "deviceId");
    if (!deviceId) continue;
    out.push({
      deviceId,
      role: nullableString(row.role),
      channel: nullableNumber(row.channel),
      rssiDbm: nullableNumber(row.rssiDbm),
      seenAtUnix: nullableNumber(row.seenAtUnix),
    });
  }
  // An EMPTY list is a real reading — the node has no linked peers / no
  // video streams / no CAN buses right now — and it must be forwarded as
  // one. Collapsing it to `undefined` translated "nothing here" into "no
  // update", so the LAST NON-EMPTY list persisted in the cloud row
  // forever: a dead radio kept showing its peers.
  return out;
}

export interface VideoStreamEntry {
  id: string;
  role?: string;
  codec?: string;
  live?: boolean;
}

// Build the per-leg video-stream list, keeping only entries the strict inner
// validator declares. A leg with no `id` is dropped rather than failing the
// whole heartbeat. Returns undefined when the agent omits the key.
export function videoStreamsField(
  body: Record<string, unknown>,
): VideoStreamEntry[] | undefined {
  const raw = body.videoStreams;
  if (!Array.isArray(raw)) return undefined;
  const out: VideoStreamEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = stringField(row, "id");
    if (!id) continue;
    out.push({
      id,
      role: stringField(row, "role"),
      codec: stringField(row, "codec"),
      live: booleanField(row, "live"),
    });
  }
  // An EMPTY list is a real reading — the node has no linked peers / no
  // video streams / no CAN buses right now — and it must be forwarded as
  // one. Collapsing it to `undefined` translated "nothing here" into "no
  // update", so the LAST NON-EMPTY list persisted in the cloud row
  // forever: a dead radio kept showing its peers.
  return out;
}

export interface CanBusEntry {
  port: number;
  driver: number;
  bitrate: number;
  protocol: number;
}

// Build the FC CAN-bus table. Every field is required by the inner validator,
// so an entry missing one is dropped rather than rejecting the heartbeat.
export function canBusesField(body: Record<string, unknown>): CanBusEntry[] | undefined {
  const raw = body.canBuses;
  if (!Array.isArray(raw)) return undefined;
  const out: CanBusEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const port = numberField(row, "port");
    const driver = numberField(row, "driver");
    const bitrate = numberField(row, "bitrate");
    const protocol = numberField(row, "protocol");
    if (
      port === undefined ||
      driver === undefined ||
      bitrate === undefined ||
      protocol === undefined
    ) {
      continue;
    }
    out.push({ port, driver, bitrate, protocol });
  }
  // An EMPTY list is a real reading — the node has no linked peers / no
  // video streams / no CAN buses right now — and it must be forwarded as
  // one. Collapsing it to `undefined` translated "nothing here" into "no
  // update", so the LAST NON-EMPTY list persisted in the cloud row
  // forever: a dead radio kept showing its peers.
  return out;
}

export interface CameraUsbRecoveryPayload {
  state?: string | null;
  case?: string | null;
  attempts?: number | null;
  maxAttempts?: number | null;
  cameraPresent?: boolean | null;
  expected?: boolean | null;
  pppsCapable?: boolean | null;
}

// Build the camera USB-recovery block, forwarding only the known fields and
// coercing each to its validator-accepted shape so a malformed agent payload
// cannot fail the whole heartbeat. Returns undefined when the agent omits it.
export function cameraUsbRecoveryField(
  body: Record<string, unknown>,
): CameraUsbRecoveryPayload | undefined {
  const raw = body.cameraUsbRecovery;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const out: CameraUsbRecoveryPayload = {};
  const state = nullableString(row.state);
  const caseValue = nullableString(row.case);
  const attempts = nullableNumber(row.attempts);
  const maxAttempts = nullableNumber(row.maxAttempts);
  const cameraPresent = nullableBoolean(row.cameraPresent);
  const expected = nullableBoolean(row.expected);
  const pppsCapable = nullableBoolean(row.pppsCapable);
  if (state !== undefined) out.state = state;
  if (caseValue !== undefined) out.case = caseValue;
  if (attempts !== undefined) out.attempts = attempts;
  if (maxAttempts !== undefined) out.maxAttempts = maxAttempts;
  if (cameraPresent !== undefined) out.cameraPresent = cameraPresent;
  if (expected !== undefined) out.expected = expected;
  if (pppsCapable !== undefined) out.pppsCapable = pppsCapable;
  return out;
}

export interface ConfigErrorEntry {
  service: string;
  error: string;
}

// Build the per-service config-load-error array, dropping any entry that lacks a
// string service or a string error so the strict pushStatus validator accepts
// the whole block. Returns undefined when the agent omits the field.
export function configErrorsField(
  body: Record<string, unknown>,
): ConfigErrorEntry[] | undefined {
  const raw = body.configErrors;
  if (!Array.isArray(raw)) return undefined;
  const out: ConfigErrorEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const service = stringField(row, "service");
    const error = stringField(row, "error");
    if (!service || !error) continue;
    out.push({ service, error });
  }
  return out;
}
