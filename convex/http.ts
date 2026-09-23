import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { snakeToCamelObject } from "./heartbeatCasing";
import { agentKeyMatches, constantTimeEqual } from "./lib/credentials";
import { sourceBucketKey } from "./lib/rateLimit";
import { pushStatusArgs } from "./cmdDroneStatus";
import {
  booleanField,
  jsonHeaders,
  boundedField,
  cameraUsbRecoveryField,
  canBusesField,
  commandResultField,
  commandStatusField,
  computeClusterSlavesField,
  configErrorsField,
  crsfField,
  linkedPeersField,
  manualConnectionUrlsField,
  nullableBoolean,
  nullableNumber,
  nullableString,
  numberArrayField,
  numberField,
  peripheralStatesField,
  pluginInventoryField,
  radioField,
  serviceListField,
  stringArrayField,
  stringField,
  videoStreamsField,
} from "./lib/heartbeatFields";
import { resolveAtlasJobPost } from "./lib/atlasJobsIngest";


const http = httpRouter();
auth.addHttpRoutes(http);



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

// ── ADOS Pairing: agent registers its pairing code ──────────

http.route({
  path: "/pairing/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const deviceId = stringField(body, "deviceId");
    const pairingCode = stringField(body, "pairingCode");
    const apiKey = stringField(body, "apiKey");

    // apiKey is required, not optional. It is the value the paired-device
    // binding in `registerAgent` anchors to, and a blank one persisted a row
    // that could never be authenticated.
    if (!deviceId || !pairingCode || !apiKey) {
      return new Response(
        JSON.stringify({ error: "deviceId, pairingCode and apiKey required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const result = await ctx.runMutation(internal.cmdPairing.registerAgent, {
      clientKey: await sourceBucketKey(request),
      deviceId,
      pairingCode,
      apiKey,
      name: stringField(body, "name"),
      version: stringField(body, "version"),
      board: stringField(body, "board"),
      tier: numberField(body, "tier"),
      os: stringField(body, "os"),
      mdnsHost: stringField(body, "mdnsHost"),
      localIp: stringField(body, "localIp"),
      pairingCodeExpiresAt: numberField(body, "pairingCodeExpiresAt"),
    });

    // A lockout is a distinct, temporary, actionable condition. Reporting it
    // as a generic failure would leave an operator unable to tell a throttled
    // beacon from a broken backend, which is the same indistinguishable
    // failure the limiter exists to remove. The mutation returns the refusal
    // (rather than throwing) so the recorded attempt commits.
    if ("retryAfterMs" in result) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: {
          ...jsonHeaders,
          "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
        },
      });
    }

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
    // The agent presents the key it registered with. Without this the route is
    // a claim oracle: a deviceId alone revealed whether a device was
    // registered, whether it had been claimed, and by whom.
    const apiKey = request.headers.get("X-ADOS-Key") ?? "";
    if (!deviceId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "deviceId and X-ADOS-Key required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const status = await ctx.runQuery(internal.cmdPairing.getPairingStatus, {
      deviceId,
      apiKey,
    });
    if (!status.authorized) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }
    const { authorized: _authorized, ...payload } = status;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Broker auth sync: mosquitto passwd + ACL regeneration ───
//
// The self-host counterpart to the production deployment's route of the same
// name. Its absence here was invisible to both twin gates -- they compare only
// functions present in BOTH trees, so a one-sided ABSENCE reads as agreement --
// and it meant `tools/mqtt-bridge/deploy/scripts/regenerate-passwd.sh` shipped
// in this repo pointing at an endpoint this repo's own deployment did not
// serve. Device MQTT auth and operator write grants were therefore dead on
// every self-host: the script 404s, the passwd file never regenerates, and the
// broker silently refuses every device.
http.route({
  path: "/admin/mqtt-auth-entries",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.MQTT_AUTH_RELAY_SECRET;
    if (!expected) {
      return new Response(
        JSON.stringify({ error: "MQTT_AUTH_RELAY_SECRET not configured" }),
        { status: 503, headers: jsonHeaders }
      );
    }
    const header = request.headers.get("Authorization") ?? "";
    const presented = header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : "";
    // Constant-time: this route returns every paired drone's username and API
    // key, so a plain `!==` that returns at the first differing byte is a
    // timing oracle on the one secret guarding the whole set.
    if (!presented || !constantTimeEqual(presented, expected)) {
      return new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: jsonHeaders }
      );
    }
    // The query returns `{ entries, grants, truncated }`. Spread rather than
    // re-wrap: wrapping would nest it as `{ entries: { entries, ... } }` and
    // the regeneration script reads `.entries[]` directly.
    const payload = await ctx.runQuery(
      internal.cmdPairing.listMqttAuthEntries,
      {},
    );
    return new Response(
      JSON.stringify(payload),
      { status: 200, headers: jsonHeaders }
    );
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
    // The key is accepted from the `X-ADOS-Key` header like every other
    // device route; the body field stays readable for agents that predate
    // the header.
    const apiKey = request.headers.get("X-ADOS-Key") ?? stringField(body, "apiKey");
    if (!deviceId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "deviceId and apiKey required" }),
        { status: 400, headers: jsonHeaders }
      );
    }
    const result = await ctx.runMutation(internal.cmdDrones.updateHeartbeat, {
      deviceId,
      apiKey,
      lastIp: stringField(body, "lastIp"),
      mdnsHost: stringField(body, "mdnsHost"),
      fcConnected: booleanField(body, "fcConnected"),
      agentVersion: stringField(body, "agentVersion"),
    });
    // ONE uniform refusal for both `not_found` and `invalid_key`, at 401.
    //
    // This used to serialise the mutation's distinguishable error at HTTP
    // 200, so an unauthenticated caller learned whether any guessed
    // `deviceId` was registered — exactly the enumeration oracle
    // `getPairingStatus` was deliberately hardened against with its uniform
    // `{authorized:false}`. A real agent whose key had been rotated also saw
    // 200 and could not tell an accepted heartbeat from a rejected one.
    if (result && typeof result === "object" && "error" in result) {
      return new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: jsonHeaders }
      );
    }
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
    if (!drone || !agentKeyMatches(drone.apiKey, apiKey)) {
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
      // Both are shape-validated so a malformed entry can never fail the whole
      // heartbeat.
      pluginInventory: pluginInventoryField(body),
      peripheralStates: peripheralStatesField(body),
      // The free-form peripheral manifest. The agent DOES send this over the
      // cloud path (`Peripheral { category, type, ... }` on the Rust heartbeat),
      // and dropping it here is what left `cmd_drones.attachedDisplayType`
      // permanently undefined on every self-hosted deployment: `pushStatus`
      // derives the LCD pill from `peripherals[].category === "display"`, so the
      // derivation had no input and the pill was dead. Forwarded verbatim when
      // it is an array; the column is `v.any()` so shape is the agent's business.
      peripherals: Array.isArray(body.peripherals) ? body.peripherals : undefined,
      // `scripts`, `peers`, `enrollment` and `logs` are declared on pushStatus
      // and reserved -- the current heartbeat does not carry them at the root,
      // so there is nothing to forward yet. Reserved, not absent from the
      // agent: when one starts being emitted it gets picked here, the same way
      // `peripherals` above had to be. The twin gate holds the list of four so
      // a fifth cannot join them by omission.
      telemetry: body.telemetry,
      // Inter-rig peer presence (drives the WFB "Peer" badge). Drone
      // heartbeats carry the GS identity; GS heartbeats carry the drone's.
      // Each stays undefined / null exactly as the agent reports.
      peerDeviceId: nullableString(body.peerDeviceId),
      peerRole: nullableString(body.peerRole),
      peerChannel: nullableNumber(body.peerChannel),
      peerRssiDbm: nullableNumber(body.peerRssiDbm),
      peerSeenAtUnix: nullableNumber(body.peerSeenAtUnix),
      linkedPeers: linkedPeersField(body),
      // Primary camera discovery state + USB camera-recovery self-heal block.
      cameraState: nullableString(body.cameraState),
      cameraUsbRecovery: cameraUsbRecoveryField(body),
      // Per-service config-load errors. This route PICKS fields explicitly (it
      // does not spread the body), so this must be listed here or pushStatus
      // never receives it and the Health surface can never show a config error.
      configErrors: configErrorsField(body),
      radio: radioField(body, "radio"),
      // Optional CRSF/ExpressLRS control-lane block, remapped snake->camel like
      // the radio block. Must be picked here or an emitting agent's block is
      // silently dropped from every cloud heartbeat through this deployment.
      crsf: crsfField(body, "crsf"),
      // The LCD / local-display surface, the on-board decoder + recording
      // legs, the operator's theme, the resolved display path, the plugin
      // update-sweep stamp, the per-leg video streams, the FC CAN-bus table and
      // the vision summary. Every one of these is emitted by the agent, declared
      // on `pushStatus`, and has a `cmd_droneStatus` column — and this route,
      // which picks explicitly rather than spreading, forwarded none of them. On
      // a self-hosted deployment that is the whole LCD tab, the CAN rows, the
      // vision panel and the stream switcher reading empty off the cloud path
      // while the same agent fills them over the LAN.
      lcdActivePage: stringField(body, "lcdActivePage"),
      lcdTouchCalibrated: booleanField(body, "lcdTouchCalibrated"),
      lcdRotation: numberField(body, "lcdRotation"),
      lcdSnapshotUrl: stringField(body, "lcdSnapshotUrl"),
      lcdLastTouchAt: numberField(body, "lcdLastTouchAt"),
      lcdLastGesture: stringField(body, "lcdLastGesture"),
      videoLocalDecoderActive: booleanField(body, "videoLocalDecoderActive"),
      videoLocalDecoderType: stringField(body, "videoLocalDecoderType"),
      videoLocalDecoderFps: numberField(body, "videoLocalDecoderFps"),
      videoRecording: booleanField(body, "videoRecording"),
      uiTheme: stringField(body, "uiTheme"),
      displayType: stringField(body, "displayType"),
      last_plugin_update_check_at: numberField(body, "last_plugin_update_check_at"),
      videoStreams: videoStreamsField(body),
      canBuses: canBusesField(body),
      visionActiveModel: nullableString(body.visionActiveModel),
      visionBackend: nullableString(body.visionBackend),
      visionDetectionsPerSec: numberField(body, "visionDetectionsPerSec"),
      visionFps: numberField(body, "visionFps"),
    };
    // A payload the strict validator rejects degrades to a 400 with a stable
    // code, NOT an unhandled 500. The 500 path stopped `lastSeen` advancing,
    // so the aircraft read OFFLINE — an outage indistinguishable from a real
    // one and with no cause visible in the UI. One bad telemetry block must
    // never take the whole 5 s heartbeat down.
    try {
      const result = await ctx.runMutation(internal.cmdDroneStatus.pushStatus, statusPayload);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: jsonHeaders,
      });
    } catch (err) {
      console.error("[/agent/status] pushStatus rejected the payload", err);
      return new Response(
        JSON.stringify({ error: "invalid_status_payload" }),
        { status: 400, headers: jsonHeaders },
      );
    }
  }),
});

// ── Cloud Relay: compute node pushes an Atlas reconstruct job ──────────
//
// A workstation/compute node POSTs its reconstruct jobs so the World Model
// tab's cloud path surfaces the drone's world models (cmd_atlasJobs; the GCS
// reads them local-first over the LAN, this is the secondary/remote path).
// Validation (poster auth, subject ownership, URL scheme, length caps) lives in
// lib/atlasJobsIngest so every deployment runs the same tested decision.

http.route({
  path: "/agent/atlas-jobs",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJsonObject(request);
    if (body instanceof Response) return body;
    const job = await resolveAtlasJobPost(
      body,
      request.headers.get("X-ADOS-Key") ?? undefined,
      (deviceId) => ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId }),
    );
    if (job instanceof Response) return job;
    await ctx.runMutation(internal.cmdAtlasJobs.upsertJob, job);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Cloud Relay: agent polls for pending commands ──────────
//
// The poll leases the rows the agent may still run (cmdDroneCommands.
// claimCommands): a leased row is not handed out again while its lease holds,
// a row past its delivery window is failed instead, and the agent executes and
// acks each.

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
    if (!drone || !agentKeyMatches(drone.apiKey, apiKey)) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const commands = await ctx.runMutation(internal.cmdDroneCommands.claimCommands, { deviceId });
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
    if (!drone || !agentKeyMatches(drone.apiKey, apiKey)) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    // Only a terminal verdict the agent actually stated is recorded; a missing
    // or unknown status is refused rather than read as success.
    const ackStatus = commandStatusField(status);
    if (!ackStatus) {
      return new Response(
        JSON.stringify({ error: "status must be completed or failed" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const ackResult = await ctx.runMutation(internal.cmdDroneCommands.ackCommand, {
      commandId: commandId as Id<"cmd_droneCommands">,
      deviceId,
      status: ackStatus,
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
    if (!drone || !agentKeyMatches(drone.apiKey, apiKey)) {
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
