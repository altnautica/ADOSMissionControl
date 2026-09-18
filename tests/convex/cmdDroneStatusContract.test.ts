/**
 * Wire contract for the cloud status heartbeat, asserted against the RUNTIME
 * validators and the real coercion helpers.
 *
 * This file used to `readFile` `cmdDroneStatus.ts`, `schema.ts` and
 * `http.ts` and match substrings of their source — 38 reads across ~900
 * lines. That pins the spelling of identifiers, not behaviour: it passes
 * while the code is wrong and fails when the code is merely reformatted,
 * and every CRITICAL the audit found in this layer sailed through it. A
 * Convex validator is an ordinary object at runtime and the payload
 * coercion now lives in `convex/lib/heartbeatFields.ts` as pure exports,
 * so both are directly inspectable.
 *
 * What is actually at stake: `pushStatus` takes a strict `v.object()` for
 * the `radio` and `crsf` blocks, so ONE undeclared key does not get
 * dropped — it rejects the whole mutation, `lastSeen` stops advancing and
 * the fleet goes dark in cloud mode.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { pushStatusArgs } from "../../convex/cmdDroneStatus";
import schema from "../../convex/schema";
import { snakeToCamelObject } from "../../convex/heartbeatCasing";
import { crsfField, radioField } from "../../convex/lib/heartbeatFields";

// ── validator introspection ──────────────────────────────────────────

interface ValidatorNode {
  kind: string;
  isOptional?: string;
  fields?: Record<string, ValidatorNode>;
  value?: ValidatorNode;
  members?: ValidatorNode[];
  element?: ValidatorNode;
}

const asNode = (v: unknown) => v as unknown as ValidatorNode;

/** Unwrap `v.optional(x)` to `x`. */
function inner(node: ValidatorNode): ValidatorNode {
  return node.value ?? node;
}

function isOptional(node: ValidatorNode): boolean {
  return node.isOptional === "optional";
}

/** The declared keys of an object validator, unwrapping optionality. */
function keysOf(node: ValidatorNode): Set<string> {
  return new Set(Object.keys(inner(node).fields ?? {}));
}

/** True when the validator admits `null` (a `v.union` containing `v.null`). */
function acceptsNull(node: ValidatorNode): boolean {
  const n = inner(node);
  if (n.kind === "null") return true;
  return (n.members ?? []).some((m) => m.kind === "null");
}

const ARGS = pushStatusArgs as unknown as Record<string, ValidatorNode>;
const TABLE = asNode(schema.tables.cmd_droneStatus.validator);
const TABLE_FIELDS = inner(TABLE).fields ?? {};


// ── fixtures: what an agent actually puts on the wire ────────────────

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

const COMPUTE_FIELDS: ReadonlyArray<[string, string]> = [
  ["computeRole", "v.optional(v.string())"],
  ["computeClusterMasterId", "v.optional(v.string())"],
  ["computeQueueDepth", "v.optional(v.number())"],
  ["computeActiveJobs", "v.optional(v.number())"],
  ["computeWorkersIdle", "v.optional(v.number())"],
  ["computeClusterAggregateWorkersIdle", "v.optional(v.number())"],
];

const LINKED_PEER_ENTRY_KEYS = [
  "deviceId",
  "role",
  "channel",
  "rssiDbm",
  "seenAtUnix",
] as const;

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

const AGENT_TOPLEVEL_WIRE_KEYS = [
  "apiUrl",
  "boardArch",
  "boardName",
  "boardRamMb",
  "boardSoc",
  "boardTier",
  "cloudPosture",
  "cloudRelayUrl",
  "cloudflareUrl",
  "cpuCores",
  "cpuHistory",
  "cpuPercent",
  "deviceId",
  "diskPercent",
  "diskTotalGb",
  "diskUsedGb",
  "fcBaud",
  "fcConnected",
  "fcFirmware",
  "fcLinkHint",
  "fcPort",
  "fcReachable",
  "fcSource",
  "fcVariant",
  "hasAccelerator",
  "heartbeatAgeS",
  "kernelRelease",
  "lastIp",
  "manualConnectionUrls",
  "mavlinkAlive",
  "mavlinkWsPort",
  "mdnsHost",
  "memoryAvailableMb",
  "memoryCacheMb",
  "memoryHistory",
  "memoryPercent",
  "memoryTotalMb",
  "memoryUsedMb",
  "missionControlUrl",
  "npuTops",
  "perceptionOffloadTarget",
  "perceptionTier",
  "processCpuPercent",
  "processMemoryMb",
  "radio",
  "remoteAccess",
  "services",
  "setupUrl",
  "swapPercent",
  "swapTotalMb",
  "swapUsedMb",
  "temperature",
  "transportOpen",
  "uptimeSeconds",
  "version",
  "videoRestartAttempts",
  "videoWhepPort",
  "wfbAdapterInjectionOk",
  "wfbModuleSource",
] as const;

const CRSF_FIELD_TYPES = {
  v: "number",
  state: "string",
  rssiDbm: "number",
  lqUplink: "number",
  lqDownlink: "number",
  snrDb: "number",
  band: "string",
  packetRateHz: "number",
  txPowerMw: "number",
  txFramesPerS: "number",
  rxFramesPerS: "number",
  rfUnverified: "boolean",
  mode: "string",
  channelSource: "string",
  relayRole: "string",
  fcCommandDownGated: "boolean",
} as const;

const PRODUCER_CRSF_SNAKE_BLOCK = {
  v: 1,
  state: "link_ok",
  rssi_dbm: -51,
  lq_uplink: 100,
  lq_downlink: 96,
  snr_db: 9,
  band: "900",
  packet_rate_hz: 150,
  tx_power_mw: 100,
  tx_frames_per_s: 150,
  rx_frames_per_s: 148,
  rf_unverified: false,
  mode: "crsf_rc",
  channel_source: "gemini",
  relay_role: "direct",
  fc_command_down_gated: false,
} as const;

// ── required / optional shape ────────────────────────────────────────

describe("pushStatus argument shape", () => {
  it("requires deviceId, version and uptimeSeconds", () => {
    for (const key of ["deviceId", "version", "uptimeSeconds"] as const) {
      expect(ARGS[key], `${key} must be declared`).toBeDefined();
      expect(isOptional(ARGS[key]), `${key} must be required`).toBe(false);
    }
  });

  it("does not accept updatedAt — the cloud stamps it", () => {
    // An agent-supplied timestamp would let a node backdate its own
    // liveness, which is exactly the value every staleness gate reads.
    expect(ARGS.updatedAt).toBeUndefined();
  });

  it("declares every optional system-resource field as optional", () => {
    for (const [key] of SYSTEM_RESOURCE_FIELDS) {
      expect(ARGS[key], `${key} missing from pushStatus args`).toBeDefined();
      expect(isOptional(ARGS[key]), `${key} must be optional`).toBe(true);
    }
  });

  it("declares every compute field as optional", () => {
    for (const [key] of COMPUTE_FIELDS) {
      expect(ARGS[key], `${key} missing from pushStatus args`).toBeDefined();
      expect(isOptional(ARGS[key]), `${key} must be optional`).toBe(true);
    }
  });

  it("declares pluginState as an opaque optional record", () => {
    // Per-plugin columns on the core schema would make every new extension
    // a core schema change; telemetry rides one generic channel.
    expect(ARGS.pluginState).toBeDefined();
    expect(isOptional(ARGS.pluginState)).toBe(true);
    const atlasish = Object.keys(TABLE_FIELDS).filter((k) =>
      /^atlas[A-Z]/.test(k),
    );
    expect(atlasish, "core schema grew a per-plugin column").toEqual([]);
  });

  it("declares linkedPeers as an optional array carrying the producer's keys", () => {
    expect(ARGS.linkedPeers).toBeDefined();
    expect(isOptional(ARGS.linkedPeers)).toBe(true);
    const element = inner(ARGS.linkedPeers).element;
    expect(element, "linkedPeers must be an array validator").toBeDefined();
    const declared = keysOf(asNode(element));
    for (const key of LINKED_PEER_ENTRY_KEYS) {
      expect(declared.has(key), `linkedPeers entry missing ${key}`).toBe(true);
    }
    // deviceId identifies the peer; without it a row cannot be attributed.
    const deviceId = inner(asNode(element)).fields?.deviceId;
    expect(deviceId && isOptional(deviceId)).toBe(false);
  });
});

// ── args ↔ schema parity ─────────────────────────────────────────────

describe("pushStatus args and the cmd_droneStatus table agree", () => {
  it("declares a column for every published argument", () => {
    const missing = Object.keys(ARGS).filter((k) => !(k in TABLE_FIELDS));
    expect(missing, "arguments with nowhere to land").toEqual([]);
  });
});

// ── the radio block ──────────────────────────────────────────────────

describe("radio block", () => {
  it("declares every key an agent emits, on both the mutation and the table", () => {
    const onArgs = keysOf(ARGS.radio);
    const onTable = keysOf(asNode(TABLE_FIELDS.radio));
    for (const key of AGENT_RADIO_WIRE_KEYS) {
      expect(onArgs.has(key), `mutation radio block missing ${key}`).toBe(true);
      expect(onTable.has(key), `schema radio block missing ${key}`).toBe(true);
    }
  });

  it("declares the same key set on the mutation and the table", () => {
    expect([...keysOf(ARGS.radio)].sort()).toEqual(
      [...keysOf(asNode(TABLE_FIELDS.radio))].sort(),
    );
  });

  it("keeps rfUnverified nullable so 'no verdict' stays distinct from false", () => {
    const onArgs = inner(ARGS.radio).fields?.rfUnverified;
    expect(onArgs && acceptsNull(onArgs)).toBe(true);
  });

  it("keeps the adapter USB link-health keys nullable", () => {
    for (const key of ["adapterUsbDegraded", "adapterUsbSpeedMbps"] as const) {
      const field = inner(ARGS.radio).fields?.[key];
      expect(field, `${key} missing`).toBeDefined();
      expect(acceptsNull(asNode(field)), `${key} must admit null`).toBe(true);
    }
  });
});

// ── the crsf block ───────────────────────────────────────────────────

describe("crsf block", () => {
  it("declares every key an agent emits, on both the mutation and the table", () => {
    const onArgs = keysOf(ARGS.crsf);
    const onTable = keysOf(asNode(TABLE_FIELDS.crsf));
    for (const key of Object.keys(CRSF_FIELD_TYPES)) {
      expect(onArgs.has(key), `mutation crsf block missing ${key}`).toBe(true);
      expect(onTable.has(key), `schema crsf block missing ${key}`).toBe(true);
    }
  });

  it("declares the same key set on the mutation and the table", () => {
    expect([...keysOf(ARGS.crsf)].sort()).toEqual(
      [...keysOf(asNode(TABLE_FIELDS.crsf))].sort(),
    );
  });

  it("keeps the whole block optional so a non-emitting agent round-trips", () => {
    expect(isOptional(ARGS.crsf)).toBe(true);
  });

  it("keeps every field optional AND nullable", () => {
    const fields = inner(ARGS.crsf).fields ?? {};
    for (const key of Object.keys(CRSF_FIELD_TYPES)) {
      const field = fields[key];
      expect(field, `${key} missing`).toBeDefined();
      expect(isOptional(field), `${key} must be optional`).toBe(true);
      expect(acceptsNull(field), `${key} must admit null`).toBe(true);
    }
  });
});

// ── the route transform, called directly ─────────────────────────────

describe("crsf block survives the /agent/status transform", () => {
  it("remaps every producer key to a validator-declared key", () => {
    const camel = snakeToCamelObject(PRODUCER_CRSF_SNAKE_BLOCK) as Record<
      string,
      unknown
    >;
    const declared = keysOf(ARGS.crsf);
    const undeclared = Object.keys(camel).filter((k) => !declared.has(k));
    expect(undeclared, "a key the strict validator would reject").toEqual([]);
  });

  it("forwards field values unchanged through the remap", () => {
    const out = crsfField({ crsf: PRODUCER_CRSF_SNAKE_BLOCK }, "crsf") as
      | Record<string, unknown>
      | undefined;
    expect(out).toBeDefined();
    const camel = snakeToCamelObject(PRODUCER_CRSF_SNAKE_BLOCK) as Record<
      string,
      unknown
    >;
    for (const [key, value] of Object.entries(camel)) {
      if (!keysOf(ARGS.crsf).has(key)) continue;
      expect(out![key], `${key} changed in transit`).toEqual(value);
    }
  });

  it("drops a malformed block instead of failing the heartbeat", () => {
    // The alternative is an ArgumentValidationError inside runMutation,
    // which 500s the whole 5 s heartbeat over one bad sub-object.
    expect(crsfField({ crsf: "not an object" }, "crsf")).toBeUndefined();
    expect(crsfField({ crsf: 42 }, "crsf")).toBeUndefined();
    expect(crsfField({}, "crsf")).toBeUndefined();
  });

  it("drops an UNDECLARED key rather than rejecting the heartbeat", () => {
    // The whole point of the filter: a newer agent emitting a field this
    // deployment has never heard of must degrade to one missing field.
    const out = crsfField(
      { crsf: { ...PRODUCER_CRSF_SNAKE_BLOCK, brand_new_field: 7 } },
      "crsf",
    ) as Record<string, unknown> | undefined;
    expect(out).toBeDefined();
    expect("brandNewField" in out!).toBe(false);
    const declared = keysOf(ARGS.crsf);
    for (const key of Object.keys(out!)) {
      expect(declared.has(key), `${key} would reject the mutation`).toBe(true);
    }
  });
});

describe("radio block survives the /agent/status transform", () => {
  it("drops an undeclared key rather than rejecting the heartbeat", () => {
    const out = radioField(
      { radio: { state: "paired", brand_new_field: 7 } },
      "radio",
    ) as Record<string, unknown> | undefined;
    expect(out).toBeDefined();
    expect("brandNewField" in out!).toBe(false);
    const declared = keysOf(ARGS.radio);
    for (const key of Object.keys(out!)) {
      expect(declared.has(key), `${key} would reject the mutation`).toBe(true);
    }
  });

  it("supplies every REQUIRED radio field so a sparse block still validates", () => {
    // The radio validator declares 14 required fields. An agent that sends
    // `radio: {state}` and nothing else must not take the heartbeat down.
    const out = radioField({ radio: { state: "paired" } }, "radio") as
      | Record<string, unknown>
      | undefined;
    expect(out).toBeDefined();
    const fields = inner(ARGS.radio).fields ?? {};
    const required = Object.keys(fields).filter((k) => !isOptional(fields[k]));
    const absent = required.filter((k) => !(k in out!));
    expect(absent, "required radio fields with no value").toEqual([]);
  });
});

// ── top-level wire contract ──────────────────────────────────────────

describe("top-level heartbeat wire contract", () => {
  it("declares every always-emitted key on the mutation and the table", () => {
    for (const key of AGENT_TOPLEVEL_WIRE_KEYS) {
      expect(ARGS[key], `mutation missing ${key}`).toBeDefined();
      expect(TABLE_FIELDS[key], `schema missing ${key}`).toBeDefined();
    }
  });
});
