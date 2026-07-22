import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();
auth.addHttpRoutes(http);

const jsonHeaders = { "Content-Type": "application/json" };

// Upper bound on a JSON control/heartbeat body. The heartbeat carries
// bounded telemetry + a handful of free-form objects; a well-behaved agent
// stays well under this. The cap stops a buggy or compromised-but-key-valid
// agent from pushing an oversized blob every few seconds (the binary log
// window route has its own 32 MB cap). 512 KB is generous headroom over a
// real heartbeat (low tens of KB).
const MAX_JSON_BODY_BYTES = 512 * 1024;

async function readJsonObject(request: Request): Promise<Record<string, unknown> | Response> {
  // Read the raw text so the size can be checked before parse. A
  // Content-Length header (when present) is a cheap early reject; the actual
  // byte length is the authoritative check for chunked/absent-length bodies.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "request body too large" }), {
      status: 413,
      headers: jsonHeaders,
    });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
  // Byte length (not string length) so multi-byte payloads are bounded too.
  if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "request body too large" }), {
      status: 413,
      headers: jsonHeaders,
    });
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: "JSON object required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    return body as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" ? value : undefined;
}

function booleanField(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberArrayField(
  body: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "number") ? value : undefined;
}

function stringArrayField(
  body: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

interface ServiceStatusPayload {
  name: string;
  status: string;
  cpuPercent?: number;
  memoryMb?: number;
  uptimeSeconds?: number;
  pid?: number;
  category?: string;
}

function serviceListField(
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

function commandStatusField(value: string | undefined): "completed" | "failed" {
  return value === "failed" ? "failed" : "completed";
}

interface RadioPayload {
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

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number") return value;
  return undefined;
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  return undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

// Translate the agent's snake_case radio block into the camelCase shape the
// validator and schema expect. Every key is converted generically, so any
// current or future radio field reaches pushStatus already camelCased with no
// per-field plumbing to maintain here — a field can never slip through as
// snake_case and get rejected by the strict validator. Adding a new field then
// only needs the validator + schema (this stays untouched). Returns undefined
// when the block is absent so the heartbeat stays additive. The RadioPayload
// interface above documents the known fields; the cast bridges the generic
// object onto it for the typed status payload.
function radioField(
  body: Record<string, unknown>,
  key: string,
): RadioPayload | undefined {
  const raw = body[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const remapped: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(raw as Record<string, unknown>)) {
    const camelKey = k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    remapped[camelKey] = value;
  }
  return remapped as unknown as RadioPayload;
}

function commandResultField(
  value: unknown,
): { success: boolean; message: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const success = booleanField(row, "success");
  const message = stringField(row, "message");
  if (success === undefined || !message) return undefined;
  return { success, message };
}

interface ManualConnectionUrlsPayload {
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
function manualConnectionUrlsField(
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

interface PluginInventoryEntry {
  plugin_id: string;
  version?: string | null;
  status?: string | null;
}

// Build the plugin-inventory array, dropping any entry that lacks a string
// plugin_id so the strict pushStatus validator accepts the whole block.
// Returns undefined when the agent omits the field.
function pluginInventoryField(
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

interface PeripheralStateEntry {
  id: string;
  connected: boolean;
  last_seen?: number | null;
}

// Build the compact per-peripheral connection-state array (drives the
// connected/disconnected dot on the drone card). Drops any entry missing a
// string id or a boolean connected flag so the strict validator accepts the
// block. Returns undefined when the agent omits the field.
function peripheralStatesField(
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

interface ComputeSlaveEntry {
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
function computeClusterSlavesField(
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

interface CameraUsbRecoveryPayload {
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
function cameraUsbRecoveryField(
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

interface ConfigErrorEntry {
  service: string;
  error: string;
}

// Build the per-service config-load-error array, dropping any entry that lacks a
// string service or a string error so the strict pushStatus validator accepts
// the whole block. Returns undefined when the agent omits the field.
function configErrorsField(
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

// ── ADOS Pairing: agent registers its pairing code ──────────

http.route({
  path: "/pairing/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const deviceId = stringField(body, "deviceId");
    const pairingCode = stringField(body, "pairingCode");

    if (!deviceId || !pairingCode) {
      return new Response(
        JSON.stringify({ error: "deviceId and pairingCode required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const result = await ctx.runMutation(api.cmdPairing.registerAgent, {
      deviceId,
      pairingCode,
      apiKey: stringField(body, "apiKey"),
      name: stringField(body, "name"),
      version: stringField(body, "version"),
      board: stringField(body, "board"),
      tier: numberField(body, "tier"),
      os: stringField(body, "os"),
      mdnsHost: stringField(body, "mdnsHost"),
      localIp: stringField(body, "localIp"),
      pairingCodeExpiresAt: numberField(body, "pairingCodeExpiresAt"),
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── ADOS Pairing: agent polls for claim status ──────────────

http.route({
  path: "/pairing/status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId");
    if (!deviceId) {
      return new Response(
        JSON.stringify({ error: "deviceId required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const status = await ctx.runQuery(api.cmdPairing.getPairingStatus, {
      deviceId,
    });
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── ADOS Heartbeat: agent sends periodic status ─────────────

http.route({
  path: "/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const deviceId = stringField(body, "deviceId");
    const apiKey = stringField(body, "apiKey");
    if (!deviceId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "deviceId and apiKey required" }),
        { status: 400, headers: jsonHeaders }
      );
    }
    const result = await ctx.runMutation(api.cmdDrones.updateHeartbeat, {
      deviceId,
      apiKey,
      lastIp: stringField(body, "lastIp"),
      mdnsHost: stringField(body, "mdnsHost"),
      fcConnected: booleanField(body, "fcConnected"),
      agentVersion: stringField(body, "agentVersion"),
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Cloud Relay: agent pushes full status ──────────────────

http.route({
  path: "/agent/status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const deviceId = stringField(body, "deviceId");
    const version = stringField(body, "version");
    const uptimeSeconds = numberField(body, "uptimeSeconds");
    const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;

    if (!deviceId || !apiKey || !version || uptimeSeconds === undefined) {
      return new Response(
        JSON.stringify({ error: "deviceId, apiKey, version, and uptimeSeconds required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Validate API key matches the paired drone
    const drone = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId });
    if (!drone || drone.apiKey !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    // Strip legacy auth fields and sanitize before passing to mutation.
    // Agent sends agentVersion (not in schema) and temperature: null
    // (v.float64() rejects null — must be absent or a number)
    const statusPayload = {
      deviceId,
      version,
      uptimeSeconds,
      boardName: stringField(body, "boardName"),
      boardTier: numberField(body, "boardTier"),
      boardSoc: stringField(body, "boardSoc"),
      boardArch: stringField(body, "boardArch"),
      // Probed-from-silicon hardware truth, forwarded verbatim. Each stays
      // undefined when the agent omits it so the row remains additive.
      boardSocProbed: stringField(body, "boardSocProbed"),
      boardCpuProbed: stringField(body, "boardCpuProbed"),
      hwEncoderProbed: stringField(body, "hwEncoderProbed"),
      // Kernel release + radio-module source + install-health summary.
      // Forwarded verbatim from the agent heartbeat; each stays
      // undefined when the agent omits it so the row remains additive.
      kernelRelease: stringField(body, "kernelRelease"),
      wfbModuleSource: stringField(body, "wfbModuleSource"),
      // Overall radio-stack health + the top-level mirror of the selected
      // WFB adapter verdict. The agent carries these at the heartbeat root
      // (also nested inside the radio block); forward them so a remotely
      // connected operator sees the stranded-radio warning and the radio
      // module badge. radioStackState is a plain optional string; the
      // adapter mirrors preserve the agent's explicit null ("no
      // injection-capable adapter found") so null stays distinct from
      // absent. Each stays undefined when the agent omits it so the row
      // remains additive.
      radioStackState: stringField(body, "radioStackState"),
      // Stable-MAC pin verdicts (a free-form object). Forwarded verbatim when
      // the agent sends an object; absent otherwise so the row stays additive.
      macStability:
        typeof body.macStability === "object" && body.macStability !== null
          ? body.macStability
          : undefined,
      // Management-link health (a free-form object). Forwarded verbatim when the
      // agent sends an object; absent otherwise so the row stays additive.
      managementLink:
        typeof body.managementLink === "object" &&
        body.managementLink !== null
          ? body.managementLink
          : undefined,
      // WiFi power-save reconciler verdicts (a free-form object with an
      // interfaces array). Forwarded verbatim when the agent sends an object;
      // absent otherwise so the row stays additive.
      wifiPowersave:
        typeof body.wifiPowersave === "object" &&
        body.wifiPowersave !== null
          ? body.wifiPowersave
          : undefined,
      // Management-link reach-back mode + failover interface/reason. Each stays
      // undefined when the agent omits it so the row stays additive.
      mgmtLinkMode: stringField(body, "mgmtLinkMode"),
      mgmtFailoverIface: nullableString(body.mgmtFailoverIface),
      mgmtFailoverReason: nullableString(body.mgmtFailoverReason),
      // USB-rehome self-heal state + attempt count + last outcome. Each stays
      // undefined when the agent omits it so the row stays additive.
      usbRehomeState: stringField(body, "usbRehomeState"),
      usbRehomeAttempts: nullableNumber(body.usbRehomeAttempts),
      usbRehomeLastResult: nullableString(body.usbRehomeLastResult),
      wfbAdapterChipset: nullableString(body.wfbAdapterChipset),
      wfbAdapterInjectionOk: nullableBoolean(body.wfbAdapterInjectionOk),
      wfbAdapterUsbDegraded: nullableBoolean(body.wfbAdapterUsbDegraded),
      wfbAdapterUsbSpeedMbps: nullableNumber(body.wfbAdapterUsbSpeedMbps),
      installStatus: stringField(body, "installStatus"),
      installVersion: stringField(body, "installVersion"),
      failedSteps: stringArrayField(body, "failedSteps"),
      cpuPercent: numberField(body, "cpuPercent"),
      memoryPercent: numberField(body, "memoryPercent"),
      diskPercent: numberField(body, "diskPercent"),
      temperature: numberField(body, "temperature"),
      fcConnected: booleanField(body, "fcConnected"),
      fcPort: stringField(body, "fcPort"),
      fcBaud: numberField(body, "fcBaud"),
      // Gated MAVLink truth + the FC-link diagnostic hint. This route PICKS
      // fields explicitly (it does not spread), so these must be listed here or
      // pushStatus silently never receives them and the cloud render path
      // degrades to a bare fcConnected boolean.
      transportOpen: booleanField(body, "transportOpen"),
      mavlinkAlive: booleanField(body, "mavlinkAlive"),
      heartbeatAgeS: numberField(body, "heartbeatAgeS"),
      fcSource: stringField(body, "fcSource"),
      fcLinkHint: stringField(body, "fcLinkHint"),
      // FC firmware identity + the honest connected-or-reachable verdict (an
      // MSP FC never emits the HEARTBEAT the alive gate needs, so fcConnected
      // alone under-reports it). This route PICKS fields explicitly, so each
      // must be listed here or pushStatus silently never receives it and the
      // cloud path renders a healthy MSP board as "no FC".
      fcVariant: stringField(body, "fcVariant"),
      fcFirmware: stringField(body, "fcFirmware"),
      fcReachable: booleanField(body, "fcReachable"),
      memoryUsedMb: numberField(body, "memoryUsedMb"),
      memoryTotalMb: numberField(body, "memoryTotalMb"),
      memoryAvailableMb: numberField(body, "memoryAvailableMb"),
      memoryCacheMb: numberField(body, "memoryCacheMb"),
      swapTotalMb: numberField(body, "swapTotalMb"),
      swapUsedMb: numberField(body, "swapUsedMb"),
      swapPercent: numberField(body, "swapPercent"),
      diskUsedGb: numberField(body, "diskUsedGb"),
      diskTotalGb: numberField(body, "diskTotalGb"),
      cpuCores: numberField(body, "cpuCores"),
      boardRamMb: numberField(body, "boardRamMb"),
      processCpuPercent: numberField(body, "processCpuPercent"),
      processMemoryMb: numberField(body, "processMemoryMb"),
      cpuHistory: numberArrayField(body, "cpuHistory"),
      memoryHistory: numberArrayField(body, "memoryHistory"),
      services: serviceListField(body, "services"),
      lastIp: stringField(body, "lastIp"),
      mdnsHost: stringField(body, "mdnsHost"),
      setupUrl: stringField(body, "setupUrl"),
      apiUrl: stringField(body, "apiUrl"),
      missionControlUrl: stringField(body, "missionControlUrl"),
      videoState: stringField(body, "videoState"),
      videoWhepPort: numberField(body, "videoWhepPort"),
      videoWhepUrl: stringField(body, "videoWhepUrl"),
      videoRestartAttempts: numberField(body, "videoRestartAttempts"),
      mavlinkWsPort: numberField(body, "mavlinkWsPort"),
      mavlinkWsUrl: stringField(body, "mavlinkWsUrl"),
      mavlinkWsUrlPrev: stringField(body, "mavlinkWsUrlPrev"),
      // LAN-routable manual-connection URLs the operator can dial directly.
      manualConnectionUrls: manualConnectionUrlsField(body),
      // Cloud posture + the two remote-reach URLs. The drone card renders a
      // "Local-only" pill from cloudPosture; the URLs feed the connection
      // cascade. Each stays undefined / null exactly as the agent reports.
      cloudPosture: stringField(body, "cloudPosture"),
      cloudRelayUrl: nullableString(body.cloudRelayUrl),
      cloudflareUrl: nullableString(body.cloudflareUrl),
      wfbFailoverState: stringField(body, "wfbFailoverState"),
      // Ground-station cloud-relay forwarding state, posted by the uplink-aware
      // relay bridge. This route PICKS fields explicitly (it does not spread the
      // body like the production deployment), so the six relay fields must be
      // listed here or pushStatus silently never receives them.
      uplink: stringField(body, "uplink"),
      mqttConnected: booleanField(body, "mqttConnected"),
      throttleState: stringField(body, "throttleState"),
      forwardingVideo: booleanField(body, "forwardingVideo"),
      forwardingTelemetry: booleanField(body, "forwardingTelemetry"),
      tsMs: numberField(body, "tsMs"),
      // Perception tier + the offload target (host:port), mirror of the native
      // /api/status. This route PICKS fields explicitly (it does not spread the
      // body), so both must be listed here or pushStatus never receives them and
      // the cloud surface can never agree with the LAN one on where perception
      // runs. Absent on an agent that predates the surface.
      // NPU capability the board declares — siblings of perceptionTier from
      // the same heartbeat surface, emitted as plain scalars on every tick.
      npuTops: numberField(body, "npuTops"),
      hasAccelerator: booleanField(body, "hasAccelerator"),
      perceptionTier: stringField(body, "perceptionTier"),
      perceptionOffloadTarget: stringField(body, "perceptionOffloadTarget"),
      // Compute-node cluster + job-queue telemetry from a compute-profile
      // agent's heartbeat. This route PICKS fields explicitly (it does not
      // spread the body), so each must be listed here or pushStatus never
      // receives them. Absent on a drone/GS heartbeat. "computeActiveSessions"
      // is the count of live streaming perception-offload sessions the node
      // serves (distinct from queued/active reconstruction jobs).
      computeRole: stringField(body, "computeRole"),
      computeClusterMasterId: stringField(body, "computeClusterMasterId"),
      computeQueueDepth: numberField(body, "computeQueueDepth"),
      computeActiveJobs: numberField(body, "computeActiveJobs"),
      computeActiveSessions: numberField(body, "computeActiveSessions"),
      computeWorkersIdle: numberField(body, "computeWorkersIdle"),
      computeClusterAggregateWorkersIdle: numberField(
        body,
        "computeClusterAggregateWorkersIdle",
      ),
      computeClusterSlaves: computeClusterSlavesField(body),
      // Generic plugin-state channel (a free-form { pluginId: opaqueSlice }
      // map). Forwarded verbatim when the agent sends an object so each plugin
      // owns its slice end-to-end; the core never inspects the shape. Absent
      // otherwise so the row stays additive.
      pluginState:
        typeof body.pluginState === "object" &&
        body.pluginState !== null &&
        !Array.isArray(body.pluginState)
          ? body.pluginState
          : undefined,
      setupState: stringField(body, "setupState"),
      profile: stringField(body, "profile"),
      role: stringField(body, "role"),
      profileSource: stringField(body, "profileSource"),
      runtimeMode: stringField(body, "runtimeMode"),
      remoteAccess: body.remoteAccess,
      // Webapp-side plugin installs + compact peripheral connection states.
      // These are the fields the active heartbeat actually emits (the agent
      // does not send the free-form `peripherals` manifest, `scripts`,
      // `peers`, `enrollment`, or `logs` over the cloud path, so those are
      // not forwarded). Both are shape-validated so a malformed entry can
      // never fail the whole heartbeat.
      pluginInventory: pluginInventoryField(body),
      peripheralStates: peripheralStatesField(body),
      telemetry: body.telemetry,
      // Inter-rig peer presence (drives the WFB "Peer" badge). Drone
      // heartbeats carry the GS identity; GS heartbeats carry the drone's.
      // Each stays undefined / null exactly as the agent reports.
      peerDeviceId: nullableString(body.peerDeviceId),
      peerRole: nullableString(body.peerRole),
      peerChannel: nullableNumber(body.peerChannel),
      peerRssiDbm: nullableNumber(body.peerRssiDbm),
      peerSeenAtUnix: nullableNumber(body.peerSeenAtUnix),
      // Primary camera discovery state + USB camera-recovery self-heal block.
      cameraState: nullableString(body.cameraState),
      cameraUsbRecovery: cameraUsbRecoveryField(body),
      // Per-service config-load errors. This route PICKS fields explicitly (it
      // does not spread the body), so this must be listed here or pushStatus
      // never receives it and the Health surface can never show a config error.
      configErrors: configErrorsField(body),
      radio: radioField(body, "radio"),
    };
    const result = await ctx.runMutation(internal.cmdDroneStatus.pushStatus, statusPayload);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Cloud Relay: compute node pushes an Atlas reconstruct job ──────────
//
// A workstation/compute node POSTs its reconstruct jobs so the World Model
// tab's cloud path surfaces the drone's world models (cmd_atlasJobs; the GCS
// reads them local-first over the LAN, this is the secondary/remote path).
// Auth mirrors /agent/status but with an auth-vs-attribution split: the POSTER
// (the workstation, itself a paired fleet node) is validated by posterDeviceId
// + X-ADOS-Key, while cmd_atlasJobs.deviceId is the DIFFERENT capturing-drone
// id in the body. metadata carries the honest { backend } badge (Rule 44).

http.route({
  path: "/agent/atlas-jobs",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const posterDeviceId = stringField(body, "posterDeviceId");
    const deviceId = stringField(body, "deviceId");
    const computeNodeId = stringField(body, "computeNodeId");
    const kind = stringField(body, "kind");
    const status = stringField(body, "status");
    const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;

    if (!posterDeviceId || !apiKey || !deviceId || !computeNodeId || !kind || !status) {
      return new Response(
        JSON.stringify({
          error:
            "posterDeviceId, apiKey, deviceId, computeNodeId, kind, and status required",
        }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Authenticate the POSTER (a paired workstation node), not the capturing
    // drone — the drone id is attribution, resolved by the owner-gated reads.
    const poster = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, {
      deviceId: posterDeviceId,
    });
    if (!poster || poster.apiKey !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    // metadata is a free-form object (backend badge, viewer hint, gaussian
    // count); forward it verbatim when it is a plain object, else omit.
    const metadata =
      typeof body.metadata === "object" &&
      body.metadata !== null &&
      !Array.isArray(body.metadata)
        ? body.metadata
        : undefined;

    await ctx.runMutation(internal.cmdAtlasJobs.upsertJob, {
      deviceId,
      computeNodeId,
      kind,
      status,
      sessionId: stringField(body, "sessionId"),
      inputBag: stringField(body, "inputBag"),
      outputUrl: stringField(body, "outputUrl"),
      derivedFrom: stringField(body, "derivedFrom"),
      metadata,
      startedAt: numberField(body, "startedAt"),
      finishedAt: numberField(body, "finishedAt"),
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Cloud Relay: agent polls for pending commands ──────────
//
// This read-only poll returns the queued rows; the agent then executes and
// acks each. An at-most-once delivery path exists in
// cmdDroneCommands.claimCommands (it leases each row before execution so a
// retried poll cannot re-return an in-flight command, bounded by an attempt
// budget). Switching this route to claimCommands is a coordinated change with
// the agent's claim-before-execute loop and is intentionally not made here.

http.route({
  path: "/agent/commands",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId");
    const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;

    if (!deviceId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "deviceId and apiKey required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Validate API key
    const drone = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId });
    if (!drone || drone.apiKey !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const commands = await ctx.runQuery(internal.cmdDroneCommands.getPendingCommands, { deviceId });
    return new Response(JSON.stringify({ commands }), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Cloud Relay: agent acknowledges command completion ─────

http.route({
  path: "/agent/commands/ack",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const commandId = stringField(body, "commandId");
    const deviceId = stringField(body, "deviceId");
    const status = stringField(body, "status");
    const result = commandResultField(body.result);
    const { data } = body;
    const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;

    if (!commandId || !deviceId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "commandId, deviceId, and apiKey required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Validate API key
    const drone = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId });
    if (!drone || drone.apiKey !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const ackResult = await ctx.runMutation(internal.cmdDroneCommands.ackCommand, {
      commandId: commandId as Id<"cmd_droneCommands">,
      deviceId,
      status: commandStatusField(status),
      result,
      data,
    });
    return new Response(JSON.stringify(ackResult), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Explicit log-window export: agent uploads one chosen window ──
// One authenticated binary POST. Window metadata travels as headers;
// the body is the raw exported-window blob. Auth mirrors /agent/status
// (device API key in X-ADOS-Key, validated against the paired drone).
// The server recomputes the content hash from the stored bytes inside
// ingestWindow — the agent never sends a hash claim used for storage.

http.route({
  path: "/agent/logd/window",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;
    const h = request.headers;
    const deviceId = h.get("X-ADOS-Device") ?? undefined;
    const sessionId = h.get("X-ADOS-Session") ?? "";
    const kind = h.get("X-ADOS-Kind") ?? undefined;
    const format = h.get("X-ADOS-Format") ?? undefined;
    const windowStartUs = Number(h.get("X-ADOS-Window-Start-Us"));
    const windowEndUs = Number(h.get("X-ADOS-Window-End-Us"));
    const rowCount = Number(h.get("X-ADOS-Row-Count"));

    if (
      !deviceId
      || !apiKey
      || !kind
      || !format
      || !Number.isFinite(windowStartUs)
      || !Number.isFinite(windowEndUs)
      || !Number.isFinite(rowCount)
    ) {
      return new Response(
        JSON.stringify({ error: "missing window metadata" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Validate API key matches the paired drone
    const drone = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId });
    if (!drone || drone.apiKey !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const blob = await request.blob();
    const MAX_WINDOW_BYTES = 32 * 1024 * 1024;
    if (blob.size === 0 || blob.size > MAX_WINDOW_BYTES) {
      return new Response(
        JSON.stringify({ error: "window too large or empty" }),
        { status: 413, headers: jsonHeaders }
      );
    }

    const storageId = await ctx.storage.store(blob);
    try {
      const result = await ctx.runAction(internal.cmdLogdWindows.ingestWindow, {
        deviceId,
        sessionId,
        kind,
        windowStartUs,
        windowEndUs,
        format,
        rowCount,
        storageId,
      });
      return new Response(
        JSON.stringify({
          status: result.status,
          windowId: result.windowId,
          contentHash: result.contentHash,
        }),
        { status: 200, headers: jsonHeaders }
      );
    } catch (err) {
      // ingestWindow deletes the blob on every validation failure, so a
      // rejected upload never orphans storage. Surface a 400 with the
      // kernel message for the operator.
      const message = err instanceof Error ? err.message : "ingest failed";
      return new Response(
        JSON.stringify({ error: message }),
        { status: 400, headers: jsonHeaders }
      );
    }
  }),
});

export default http;
