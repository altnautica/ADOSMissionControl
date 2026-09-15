/**
 * Tests for the pushStatus mutation surface.
 *
 * Convex internal mutations cannot be imported directly without a
 * runtime; we pin the surface by reading the source file and asserting
 * (a) the args declare every new optional field, and (b) the handler
 * forwards every new field through to db.insert / db.patch (no field
 * silently dropped on a future refactor).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MUTATION_PATH = path.join(process.cwd(), "convex/cmdDroneStatus.ts");

const NEW_OPTIONAL_FIELDS = [
  "lcdActivePage",
  "lcdTouchCalibrated",
  "lcdRotation",
  "lcdSnapshotUrl",
  "lcdLastTouchAt",
  "lcdLastGesture",
  "videoLocalDecoderActive",
  "videoLocalDecoderType",
  "videoLocalDecoderFps",
  "videoRecording",
  "uiTheme",
] as const;

const FIELD_VALIDATOR: Record<(typeof NEW_OPTIONAL_FIELDS)[number], string> = {
  lcdActivePage: "v.optional(v.string())",
  lcdTouchCalibrated: "v.optional(v.boolean())",
  lcdRotation: "v.optional(v.number())",
  lcdSnapshotUrl: "v.optional(v.string())",
  lcdLastTouchAt: "v.optional(v.number())",
  lcdLastGesture: "v.optional(v.string())",
  videoLocalDecoderActive: "v.optional(v.boolean())",
  videoLocalDecoderType: "v.optional(v.string())",
  videoLocalDecoderFps: "v.optional(v.number())",
  videoRecording: "v.optional(v.boolean())",
  uiTheme: "v.optional(v.string())",
};

describe("pushStatus mutation args", () => {
  it.each(NEW_OPTIONAL_FIELDS)(
    "declares %s on the mutation args with the expected validator",
    async (field) => {
      const text = await readFile(MUTATION_PATH, "utf8");
      const expected = `${field}: ${FIELD_VALIDATOR[field]}`;
      expect(text).toContain(expected);
    },
  );

  it("preserves the existing args (deviceId, version, radio, runtimeMode)", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    expect(text).toContain("deviceId: v.string(),");
    expect(text).toContain("version: v.string(),");
    expect(text).toContain("radio: v.optional(v.object({");
    expect(text).toContain("runtimeMode: v.optional(v.string()),");
  });

  // The HTTP relay forwards these two as top-level fields; a strict args
  // validator that omits them throws inside runMutation and fails the
  // ENTIRE heartbeat once an agent emits a real bool/number. Pin that they
  // are declared at the top level (the radio block also nests them).
  it("declares the top-level WFB USB-health mirror so the heartbeat never throws", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    expect(text).toContain(
      "wfbAdapterUsbDegraded: v.optional(v.union(v.boolean(), v.null())),",
    );
    expect(text).toContain(
      "wfbAdapterUsbSpeedMbps: v.optional(v.union(v.number(), v.null())),",
    );
  });

  // The agent emits cameraUsbRecovery and the GCS consumes it, but it was
  // undeclared in pushStatus — the strict validator would reject the whole
  // heartbeat the moment the relay forwarded it. Pin the declaration.
  it("declares the cameraUsbRecovery object so the relay can forward it", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    expect(text).toContain("cameraUsbRecovery: v.optional(");
    // Inner fields are optional + nullable so a slightly older agent
    // payload still round-trips.
    expect(text).toContain("cameraPresent: v.optional(v.union(v.boolean(), v.null())),");
    expect(text).toContain("pppsCapable: v.optional(v.union(v.boolean(), v.null())),");
  });
});

describe("cloud-relay /agent/status forwards the agent-emitted fields", () => {
  const HTTP_PATH = path.join(process.cwd(), "convex/http.ts");

  // Without these forwards the agent-emitted values never reach the
  // pushStatus mutation: the remote drone card stays dark on cloud relay.
  it("forwards the WFB USB-health mirror, cloud posture, and camera recovery", async () => {
    const text = await readFile(HTTP_PATH, "utf8");
    expect(text).toContain("wfbAdapterUsbDegraded: nullableBoolean(body.wfbAdapterUsbDegraded),");
    expect(text).toContain("wfbAdapterUsbSpeedMbps: nullableNumber(body.wfbAdapterUsbSpeedMbps),");
    expect(text).toContain("cloudPosture: stringField(body, \"cloudPosture\"),");
    expect(text).toContain("cloudRelayUrl: nullableString(body.cloudRelayUrl),");
    expect(text).toContain("cloudflareUrl: nullableString(body.cloudflareUrl),");
    expect(text).toContain("cameraUsbRecovery: cameraUsbRecoveryField(body),");
  });

  it("forwards the five inter-rig peer-presence fields", async () => {
    const text = await readFile(HTTP_PATH, "utf8");
    expect(text).toContain("peerDeviceId: nullableString(body.peerDeviceId),");
    expect(text).toContain("peerRole: nullableString(body.peerRole),");
    expect(text).toContain("peerChannel: nullableNumber(body.peerChannel),");
    expect(text).toContain("peerRssiDbm: nullableNumber(body.peerRssiDbm),");
    expect(text).toContain("peerSeenAtUnix: nullableNumber(body.peerSeenAtUnix),");
  });

  it("forwards plugin inventory, peripheral states and the peripheral manifest", async () => {
    const text = await readFile(HTTP_PATH, "utf8");
    expect(text).toContain("pluginInventory: pluginInventoryField(body),");
    expect(text).toContain("peripheralStates: peripheralStatesField(body),");
    // The agent DOES send the free-form `peripherals` manifest over the cloud
    // path, and `pushStatus` derives cmd_drones.attachedDisplayType from
    // `peripherals[].category === "display"`. Without this pick the derivation
    // has no input, so the LCD pill was dead on every self-hosted deployment
    // while the same agent filled it over the LAN.
    expect(text).toContain(
      "peripherals: Array.isArray(body.peripherals) ? body.peripherals : undefined,",
    );
  });

  it("does not forward the four reserved fields the heartbeat does not carry", async () => {
    const text = await readFile(HTTP_PATH, "utf8");
    // Declared on pushStatus and reserved: the current heartbeat carries none
    // of them at the root, so a pick would round-trip as permanently
    // undefined. The twin gate holds this same list of four, so a fifth
    // unpicked field fails there rather than joining them silently.
    expect(text).not.toContain("scripts: body.scripts,");
    expect(text).not.toContain("peers: body.peers,");
    expect(text).not.toContain("enrollment: body.enrollment,");
    expect(text).not.toContain("logs: body.logs,");
  });
});

describe("pushStatus persistence wiring", () => {
  it.each(NEW_OPTIONAL_FIELDS)(
    "forwards %s through to the persistence call",
    async (field) => {
      const text = await readFile(MUTATION_PATH, "utf8");
      // Each new field must appear as a property assignment from args
      // (e.g. `lcdActivePage: args.lcdActivePage`) so a future refactor
      // that narrows `...args` cannot silently drop it.
      const expected = `${field}: args.${field}`;
      expect(text).toContain(expected);
    },
  );

  it("calls both db.insert and db.patch with a localSurfaceFields spread", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    expect(text).toContain("...localSurfaceFields");
    expect(text).toContain('ctx.db.insert("cmd_droneStatus"');
    expect(text).toContain("ctx.db.patch(existing._id");
  });
});

/**
 * Runtime simulation: rebuild the handler-relevant logic with a fake
 * db so we can assert the stored row matches expectations both for the
 * full payload (all 11 fields) and the empty payload (none of them).
 *
 * This mirrors the structure of the real handler: pick the fields off
 * args explicitly, spread them into the row, leave undefined values
 * untouched (Convex stores `undefined` as missing, not `null`).
 */
type Row = Record<string, unknown>;

function simulateInsert(args: Row): Row {
  const localSurfaceFields = {
    lcdActivePage: args.lcdActivePage,
    lcdTouchCalibrated: args.lcdTouchCalibrated,
    lcdRotation: args.lcdRotation,
    lcdSnapshotUrl: args.lcdSnapshotUrl,
    lcdLastTouchAt: args.lcdLastTouchAt,
    lcdLastGesture: args.lcdLastGesture,
    videoLocalDecoderActive: args.videoLocalDecoderActive,
    videoLocalDecoderType: args.videoLocalDecoderType,
    videoLocalDecoderFps: args.videoLocalDecoderFps,
    videoRecording: args.videoRecording,
    uiTheme: args.uiTheme,
  };
  // Strip undefined values to mirror Convex's `optional` semantics
  // (a missing field is not the same as a null field on the row).
  const row: Row = {};
  for (const [k, v] of Object.entries({
    ...args,
    ...localSurfaceFields,
    updatedAt: 1234567890,
  })) {
    if (v !== undefined) row[k] = v;
  }
  return row;
}

describe("pushStatus row shape", () => {
  it("persists every new field when all 11 are present in args", () => {
    const args: Row = {
      deviceId: "drone-a",
      version: "0.18.4",
      uptimeSeconds: 60,
      lcdActivePage: "dashboard",
      lcdTouchCalibrated: true,
      lcdRotation: 90,
      lcdSnapshotUrl: "https://agent.local:8080/api/display/snapshot.png",
      lcdLastTouchAt: 1730000000000,
      lcdLastGesture: "swipe-left",
      videoLocalDecoderActive: true,
      videoLocalDecoderType: "h264",
      videoLocalDecoderFps: 30,
      videoRecording: false,
      uiTheme: "dark",
    };
    const row = simulateInsert(args);
    expect(row.lcdActivePage).toBe("dashboard");
    expect(row.lcdTouchCalibrated).toBe(true);
    expect(row.lcdRotation).toBe(90);
    expect(row.lcdSnapshotUrl).toBe(
      "https://agent.local:8080/api/display/snapshot.png",
    );
    expect(row.lcdLastTouchAt).toBe(1730000000000);
    expect(row.lcdLastGesture).toBe("swipe-left");
    expect(row.videoLocalDecoderActive).toBe(true);
    expect(row.videoLocalDecoderType).toBe("h264");
    expect(row.videoLocalDecoderFps).toBe(30);
    expect(row.videoRecording).toBe(false);
    expect(row.uiTheme).toBe("dark");
  });

  it("omits every new field when args do not include them (undefined, not null)", () => {
    const args: Row = {
      deviceId: "drone-b",
      version: "0.18.4",
      uptimeSeconds: 30,
    };
    const row = simulateInsert(args);
    for (const field of [
      "lcdActivePage",
      "lcdTouchCalibrated",
      "lcdRotation",
      "lcdSnapshotUrl",
      "lcdLastTouchAt",
      "lcdLastGesture",
      "videoLocalDecoderActive",
      "videoLocalDecoderType",
      "videoLocalDecoderFps",
      "videoRecording",
      "uiTheme",
    ]) {
      expect(row[field]).toBeUndefined();
      expect(field in row).toBe(false);
    }
  });

  it("preserves existing identifiers alongside the new fields", () => {
    const args: Row = {
      deviceId: "drone-c",
      version: "0.18.4",
      uptimeSeconds: 90,
      lcdActivePage: "video",
    };
    const row = simulateInsert(args);
    expect(row.deviceId).toBe("drone-c");
    expect(row.version).toBe("0.18.4");
    expect(row.uptimeSeconds).toBe(90);
    expect(row.lcdActivePage).toBe("video");
  });
});
