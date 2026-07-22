/**
 * Cloud-relay heartbeat contract tests for the `pushStatus` mutation.
 *
 * Companion to `cmdDroneStatus.test.ts` (which pins the LCD + video
 * local surface). This file owns the broader contract:
 *
 *   - required args (deviceId, version, uptimeSeconds) declare correctly
 *   - well-known optional args declare with the matching validator shape
 *   - the `cmd_droneStatus` schema table mirrors the mutation args
 *     (every field on the table appears on the mutation, and vice versa
 *     for the fields that actually need to be settable from the agent)
 *   - a snapshot of the full args key set so a future schema drift
 *     surfaces as a single, easy-to-review test diff
 *
 * Convex internal mutations cannot be invoked directly without a
 * runtime, so the contract is asserted against the source text. This
 * mirrors the established pattern in this folder.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MUTATION_PATH = path.join(process.cwd(), "convex/cmdDroneStatus.ts");
const SCHEMA_PATH = path.join(process.cwd(), "convex/schema.ts");
const HTTP_PATH = path.join(process.cwd(), "convex/http.ts");

/**
 * Parse the `args: { ... }` block out of a Convex mutation source file
 * by signature-based bracket matching. Returns a map from arg name to
 * the verbatim validator expression (e.g. `"v.optional(v.string())"`).
 *
 * This is deliberately string-based: we want to catch a future refactor
 * that changes the validator shape (e.g. `v.optional(v.string())` →
 * `v.string()` would silently break agents that omit the field).
 */
function parseArgsBlock(source: string, exportName: string): Map<string, string> {
  const exportIdx = source.indexOf(`export const ${exportName}`);
  if (exportIdx < 0) throw new Error(`export ${exportName} not found`);
  const argsIdx = source.indexOf("args:", exportIdx);
  if (argsIdx < 0) throw new Error(`args block for ${exportName} not found`);
  const openBrace = source.indexOf("{", argsIdx);
  if (openBrace < 0) throw new Error("args open brace not found");

  // Walk to the matching close brace, tracking nesting depth so nested
  // `v.object({ ... })` validators don't terminate the args block early.
  let depth = 0;
  let close = -1;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) throw new Error("args close brace not found");
  const body = source.slice(openBrace + 1, close);

  // Strip line comments first so commas inside `// ... ,` don't split
  // entries early. Block comments are not used inside the args block.
  const stripped = body
    .split("\n")
    .map((line) => {
      const slash = line.indexOf("//");
      return slash >= 0 ? line.slice(0, slash) : line;
    })
    .join("\n");

  // Split into top-level field entries (depth-aware so we don't slice
  // through a nested validator).
  const entries: string[] = [];
  let buf = "";
  let inDepth = 0;
  for (const ch of stripped) {
    if (ch === "{" || ch === "(" || ch === "[") inDepth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") inDepth -= 1;
    if (ch === "," && inDepth === 0) {
      if (buf.trim().length > 0) entries.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim().length > 0) entries.push(buf.trim());

  const map = new Map<string, string>();
  for (const entry of entries) {
    const cleaned = entry.trim();
    if (cleaned.length === 0) continue;
    const colon = cleaned.indexOf(":");
    if (colon < 0) continue;
    const name = cleaned.slice(0, colon).trim();
    const value = cleaned.slice(colon + 1).trim();
    // Skip non-identifier names (defensive against parser drift).
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    map.set(name, value);
  }
  return map;
}

/**
 * Slice out the body of the nested `radio: v.optional(v.object({ ... }))` block
 * from either the mutation or the schema source.
 *
 * The radio block is a strict `v.object()`, so it rejects any key it does not
 * declare — and because it rides every heartbeat, one undeclared key takes the
 * whole node offline in cloud mode rather than dropping a single field. The
 * assertions below work on this slice (not the whole file) so a failure prints
 * the radio block, not the entire module.
 */
function radioBlockBody(source: string): string {
  const anchor = source.indexOf("radio: v.optional(");
  if (anchor < 0) throw new Error("radio block not found");
  const open = source.indexOf("{", source.indexOf("v.object(", anchor));
  if (open < 0) throw new Error("radio object open brace not found");

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error("radio object close brace not found");
}

/** The top-level field names the radio block declares. */
function parseRadioBlockKeys(source: string): Set<string> {
  const keys = new Set<string>();
  let nesting = 0;
  for (const line of radioBlockBody(source).split("\n")) {
    const slash = line.indexOf("//");
    const code = slash >= 0 ? line.slice(0, slash) : line;
    // Only depth-0 lines name a field of the radio object itself; anything
    // deeper belongs to a nested validator.
    if (nesting === 0) {
      const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(code);
      if (match) keys.add(match[1]);
    }
    for (const ch of code) {
      if (ch === "{" || ch === "(" || ch === "[") nesting += 1;
      else if (ch === "}" || ch === ")" || ch === "]") nesting -= 1;
    }
  }
  return keys;
}

describe("pushStatus required args (audit baseline)", () => {
  it("declares deviceId, version, uptimeSeconds as required (not optional)", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    const args = parseArgsBlock(text, "pushStatus");
    expect(args.get("deviceId")).toBe("v.string()");
    expect(args.get("version")).toBe("v.string()");
    expect(args.get("uptimeSeconds")).toBe("v.number()");
  });

  it("persists updatedAt server-side (set inside the handler, not on args)", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    const args = parseArgsBlock(text, "pushStatus");
    // The agent never sends a clock value; the cloud stamps it.
    expect(args.has("updatedAt")).toBe(false);
    expect(text).toContain("const now = Date.now();");
    expect(text).toContain("updatedAt: now,");
  });
});

describe("pushStatus optional system-resource args", () => {
  // The audit called out these fields as the canonical lite + full
  // heartbeat overlap. Each must declare the matching v.optional shape
  // so an agent that omits the field round-trips cleanly.
  const SYSTEM_RESOURCE_FIELDS: ReadonlyArray<[string, string]> = [
    ["runtimeMode", "v.optional(v.string())"],
    ["cpuPercent", "v.optional(v.number())"],
    ["memoryUsedMb", "v.optional(v.number())"],
    ["memoryTotalMb", "v.optional(v.number())"],
    ["temperature", "v.optional(v.float64())"],
    ["diskPercent", "v.optional(v.number())"],
    ["cpuCores", "v.optional(v.number())"],
    ["boardRamMb", "v.optional(v.number())"],
  ];

  it.each(SYSTEM_RESOURCE_FIELDS)(
    "declares %s with the expected validator shape",
    async (field, validator) => {
      const text = await readFile(MUTATION_PATH, "utf8");
      const args = parseArgsBlock(text, "pushStatus");
      expect(args.get(field)).toBe(validator);
    },
  );
});

describe("pushStatus optional compute args", () => {
  // The whole design invariant for the compute-node fields is "all optional so
  // the drone/GS heartbeat round-trips cleanly" — every currently-live drone
  // and ground-station heartbeat OMITS these. If one were tightened to a
  // required validator, the key snapshot would still pass (the key is
  // unchanged) but every live heartbeat would start failing pushStatus. Pin
  // each field's verbatim v.optional(...) shape so that regression surfaces.
  const COMPUTE_FIELDS: ReadonlyArray<[string, string]> = [
    ["computeRole", "v.optional(v.string())"],
    ["computeClusterMasterId", "v.optional(v.string())"],
    ["computeQueueDepth", "v.optional(v.number())"],
    ["computeActiveJobs", "v.optional(v.number())"],
    ["computeWorkersIdle", "v.optional(v.number())"],
    ["computeClusterAggregateWorkersIdle", "v.optional(v.number())"],
  ];

  it.each(COMPUTE_FIELDS)(
    "declares %s with the expected validator shape",
    async (field, validator) => {
      const text = await readFile(MUTATION_PATH, "utf8");
      const args = parseArgsBlock(text, "pushStatus");
      expect(args.get(field)).toBe(validator);
    },
  );

  it("declares computeClusterSlaves as an optional array (not required)", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    const args = parseArgsBlock(text, "pushStatus");
    const validator = args.get("computeClusterSlaves");
    // The nested v.object validator spans multiple lines; assert the
    // load-bearing optionality of the array field (so an omitting drone/GS
    // heartbeat round-trips) without pinning the whole nested expression.
    expect(validator?.startsWith("v.optional(")).toBe(true);
    expect(validator).toContain("v.array(");
  });
});

describe("pushStatus generic plugin-state channel", () => {
  // Atlas (and any future plugin) telemetry rides ONE opaque pluginState map,
  // not per-plugin core columns — the core never grows a column per plugin. The
  // slice shape is the plugin's own contract; the core only declares the
  // channel (the plugin owns + validates its slice).
  it("declares pluginState as an optional opaque record", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    const args = parseArgsBlock(text, "pushStatus");
    expect(args.get("pluginState")).toBe("v.optional(v.record(v.string(), v.any()))");
  });

  it("does NOT carry per-plugin atlas columns on the core schema", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    const args = parseArgsBlock(text, "pushStatus");
    for (const col of [
      "atlasState",
      "splatGaussianCount",
      "trainingStepsPerSec",
      "atlasBearer",
      "atlasRelayDecimation",
    ]) {
      expect(args.has(col)).toBe(false);
    }
  });
});

describe("http.ts statusPayload picks the compute fields + passes pluginState through", () => {
  // The OSS-twin /agent/status route PICKS fields one by one; a compute field
  // declared on the mutation but NOT picked here is silently dropped from every
  // cloud heartbeat (the args spread never sees it). pluginState is forwarded
  // verbatim as an opaque object, not a typed scalar pick.
  const STRING_PICKS = ["computeRole", "computeClusterMasterId"];
  const NUMBER_PICKS = [
    "computeQueueDepth",
    "computeActiveJobs",
    "computeWorkersIdle",
    "computeClusterAggregateWorkersIdle",
  ];

  // Strip all whitespace so a long pick wrapped across lines matches the same as
  // a one-liner; match up to the closing quote (not the `)`) to tolerate a
  // trailing comma.
  const squash = (s: string) => s.replace(/\s+/g, "");

  it.each(STRING_PICKS)("picks %s via stringField", async (field) => {
    const text = squash(await readFile(HTTP_PATH, "utf8"));
    expect(text).toContain(`${field}:stringField(body,"${field}"`);
  });

  it.each(NUMBER_PICKS)("picks %s via numberField", async (field) => {
    const text = squash(await readFile(HTTP_PATH, "utf8"));
    expect(text).toContain(`${field}:numberField(body,"${field}"`);
  });

  it("forwards pluginState verbatim (an opaque object, not a scalar pick)", async () => {
    const text = squash(await readFile(HTTP_PATH, "utf8"));
    expect(text).toContain("pluginState:");
    expect(text).not.toContain("pluginState:stringField");
    expect(text).not.toContain("pluginState:numberField");
  });
});

describe("pushStatus args / cmd_droneStatus schema parity", () => {
  /**
   * Snapshot the full args key set. A future schema change (added or
   * removed field) shows up as a single test diff that the reviewer
   * can intentionally accept by updating the snapshot. This guards
   * against the "args silently diverges from schema" failure mode
   * where the agent reports a field the cloud quietly drops.
   */
  it("matches the recorded args key snapshot", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    const args = parseArgsBlock(text, "pushStatus");
    const keys = Array.from(args.keys()).sort();
    expect(keys).toMatchInlineSnapshot(`
      [
        "apiUrl",
        "boardArch",
        "boardCpuProbed",
        "boardName",
        "boardRamMb",
        "boardSoc",
        "boardSocProbed",
        "boardTier",
        "cameraState",
        "cameraUsbRecovery",
        "canBuses",
        "cloudPosture",
        "cloudRelayUrl",
        "cloudflareUrl",
        "computeActiveJobs",
        "computeActiveSessions",
        "computeClusterAggregateWorkersIdle",
        "computeClusterMasterId",
        "computeClusterSlaves",
        "computeQueueDepth",
        "computeRole",
        "computeWorkersIdle",
        "configErrors",
        "cpuCores",
        "cpuHistory",
        "cpuPercent",
        "deviceId",
        "diskPercent",
        "diskTotalGb",
        "diskUsedGb",
        "displayType",
        "enrollment",
        "failedSteps",
        "fcBaud",
        "fcConnected",
        "fcFirmware",
        "fcLinkHint",
        "fcPort",
        "fcSource",
        "fcVariant",
        "forwardingTelemetry",
        "forwardingVideo",
        "heartbeatAgeS",
        "hwEncoderProbed",
        "installStatus",
        "installVersion",
        "kernelRelease",
        "lastIp",
        "last_plugin_update_check_at",
        "lcdActivePage",
        "lcdLastGesture",
        "lcdLastTouchAt",
        "lcdRotation",
        "lcdSnapshotUrl",
        "lcdTouchCalibrated",
        "logs",
        "macStability",
        "managementLink",
        "manualConnectionUrls",
        "mavlinkAlive",
        "mavlinkWsPort",
        "mavlinkWsUrl",
        "mavlinkWsUrlPrev",
        "mdnsHost",
        "memoryAvailableMb",
        "memoryCacheMb",
        "memoryHistory",
        "memoryPercent",
        "memoryTotalMb",
        "memoryUsedMb",
        "mgmtFailoverIface",
        "mgmtFailoverReason",
        "mgmtLinkMode",
        "missionControlUrl",
        "mqttConnected",
        "peerChannel",
        "peerDeviceId",
        "peerRole",
        "peerRssiDbm",
        "peerSeenAtUnix",
        "peers",
        "perceptionOffloadTarget",
        "perceptionTier",
        "peripheralStates",
        "peripherals",
        "pluginInventory",
        "pluginState",
        "processCpuPercent",
        "processMemoryMb",
        "profile",
        "profileSource",
        "radio",
        "radioStackState",
        "remoteAccess",
        "role",
        "runtimeMode",
        "scripts",
        "services",
        "setupState",
        "setupUrl",
        "swapPercent",
        "swapTotalMb",
        "swapUsedMb",
        "telemetry",
        "temperature",
        "throttleState",
        "transportOpen",
        "tsMs",
        "uiTheme",
        "uplink",
        "uptimeSeconds",
        "usbRehomeAttempts",
        "usbRehomeLastResult",
        "usbRehomeState",
        "version",
        "videoCameraSource",
        "videoEncoderHwAccel",
        "videoEncoderName",
        "videoLocalDecoderActive",
        "videoLocalDecoderFps",
        "videoLocalDecoderType",
        "videoPipelineFlavor",
        "videoPipelineState",
        "videoRecording",
        "videoRestartAttempts",
        "videoState",
        "videoStreams",
        "videoWhepPort",
        "videoWhepUrl",
        "visionActiveModel",
        "visionBackend",
        "visionDetectionsPerSec",
        "visionFps",
        "wfbAdapterChipset",
        "wfbAdapterInjectionOk",
        "wfbAdapterUsbDegraded",
        "wfbAdapterUsbSpeedMbps",
        "wfbFailoverState",
        "wfbModuleSource",
        "wifiPowersave",
      ]
    `);
  });

  it("schema table cmd_droneStatus declares every published optional arg", async () => {
    // The schema does not have to declare every arg verbatim (the agent
    // may push transient fields the table chooses not to persist), but
    // every field on the table that is settable via push must appear
    // on the mutation. This catches the inverse drift: schema adds a
    // field, mutation forgets to receive it from the agent.
    const [mutationText, schemaText] = await Promise.all([
      readFile(MUTATION_PATH, "utf8"),
      readFile(SCHEMA_PATH, "utf8"),
    ]);
    const args = parseArgsBlock(mutationText, "pushStatus");

    // Spot-check fields the schema is known to expose; this avoids
    // re-parsing the entire schema file (out of scope for one test).
    const SCHEMA_FIELDS_TO_VERIFY = [
      "deviceId",
      "version",
      "uptimeSeconds",
      "runtimeMode",
      "cpuPercent",
      "memoryUsedMb",
      "temperature",
      "fcConnected",
      "lcdActivePage",
      "videoLocalDecoderActive",
      "wfbFailoverState",
      "profile",
      "role",
    ];
    for (const field of SCHEMA_FIELDS_TO_VERIFY) {
      expect(schemaText, `schema must declare ${field}`).toContain(
        `${field}:`,
      );
      expect(args.has(field), `mutation must accept ${field}`).toBe(true);
    }
  });
});

describe("radio block declares every key an agent emits", () => {
  /**
   * The radio validator is a strict `v.object()`: an undeclared key does not
   * get dropped, it rejects the ENTIRE heartbeat. Because the radio block rides
   * every heartbeat from a node with a radio, one missing key takes the whole
   * fleet dark in cloud mode the moment an updated agent starts emitting it.
   *
   * This is the radio wire contract. The agent emits these snake_case; the
   * /agent/status route camelCases every key generically before pushStatus
   * sees it, so a new field needs no route change — only this list plus both
   * validators. Extend the list in the same commit that teaches an agent to
   * emit a new radio field.
   */
  const AGENT_RADIO_WIRE_KEYS = [
    "acquireState",
    "adapterChipset",
    "adapterInjectionOk",
    "adapterUsbDegraded",
    "adapterUsbSpeedMbps",
    "autoPairEnabled",
    "bandwidthMhz",
    "bitrateKbps",
    "channel",
    "channelLocked",
    "driver",
    "fecLost",
    "fecRecovered",
    "freqMhz",
    "iface",
    "lossPercent",
    "mcsIndex",
    "noiseDbm",
    "packetsLost",
    "paired",
    "pairedAt",
    "pairedWithDeviceId",
    "phyMuted",
    "publicKeyFingerprint",
    "reacquireKills",
    "restartCount",
    "rfUnverified",
    "rssiDbm",
    "rxSilentSeconds",
    "snrDb",
    "state",
    "topology",
    "txBytesPerS",
    "txPowerDbm",
    "txPowerMaxDbm",
    "txVideoRecvqBytes",
    "txVideoStallKills",
    "txVideoStalled",
    "txZombieKills",
    "validRxPacketsPerS",
  ] as const;

  it("the mutation validator declares every emitted key", async () => {
    const declared = parseRadioBlockKeys(await readFile(MUTATION_PATH, "utf8"));
    const missing = AGENT_RADIO_WIRE_KEYS.filter((k) => !declared.has(k));
    expect(missing, "undeclared radio keys reject the whole heartbeat").toEqual(
      [],
    );
  });

  it("the schema table declares every emitted key", async () => {
    const declared = parseRadioBlockKeys(await readFile(SCHEMA_PATH, "utf8"));
    const missing = AGENT_RADIO_WIRE_KEYS.filter((k) => !declared.has(k));
    expect(missing, "a key the mutation accepts but the table rejects still fails the write").toEqual(
      [],
    );
  });

  it("the mutation and schema radio blocks declare the same key set", async () => {
    const [mutationText, schemaText] = await Promise.all([
      readFile(MUTATION_PATH, "utf8"),
      readFile(SCHEMA_PATH, "utf8"),
    ]);
    const inMutation = Array.from(parseRadioBlockKeys(mutationText)).sort();
    const inSchema = Array.from(parseRadioBlockKeys(schemaText)).sort();
    expect(inMutation).toEqual(inSchema);
  });

  // The radio block with all whitespace stripped, so a validator wrapped
  // across lines matches the same as a one-liner.
  const squashedRadioBlock = async (path: string) =>
    radioBlockBody(await readFile(path, "utf8")).replace(/\s+/g, "");

  it("keeps rfUnverified nullable so 'no verdict' stays distinct from false", async () => {
    // null means the radio reported no verdict. Storing it as false would
    // claim the transmit path had been proven, so the null must round-trip.
    for (const path of [MUTATION_PATH, SCHEMA_PATH]) {
      expect(
        await squashedRadioBlock(path),
        `${path} must accept a null rfUnverified`,
      ).toContain("rfUnverified:v.optional(v.union(v.boolean(),v.null()))");
    }
  });

  it("keeps the adapter USB link-health keys nullable on both", async () => {
    // A ground-station node reports these too; they were declared late once
    // already, after an emitting agent had started failing its heartbeats.
    for (const path of [MUTATION_PATH, SCHEMA_PATH]) {
      const block = await squashedRadioBlock(path);
      expect(block, path).toContain(
        "adapterUsbSpeedMbps:v.optional(v.union(v.number(),v.null()))",
      );
      expect(block, path).toContain(
        "adapterUsbDegraded:v.optional(v.union(v.boolean(),v.null()))",
      );
    }
  });
});
