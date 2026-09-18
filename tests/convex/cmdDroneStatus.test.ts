/**
 * Tests for the pushStatus mutation surface.
 *
 * The persistence tests invoke the REAL `pushStatus` handler against the fake
 * Convex ctx and assert the row that lands in the db. They used to assert
 * against a `simulateInsert` re-implementation of the handler written inside
 * this file, so the whole block passed unchanged if the real handler dropped
 * a field, inverted the undefined-strip, or stopped patching — which is
 * exactly the defect that shipped.
 *
 * The remaining source-text assertions pin VALIDATOR DECLARATIONS, which have
 * no runtime surface to exercise: an undeclared field is rejected by Convex
 * before any handler runs.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as cmdDroneStatus from "@/../convex/cmdDroneStatus";
import { invoke, makeCtx } from "./fakeConvexCtx";

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

describe("pushStatus persistence", () => {
  const BASE = { deviceId: "drone-a", version: "0.18.4", uptimeSeconds: 60 };

  /** Run the REAL handler against a fake db and return the stored row. */
  async function push(args: Record<string, unknown>) {
    const ctx = makeCtx();
    await invoke(cmdDroneStatus.pushStatus, ctx, args);
    return ctx.db.rows("cmd_droneStatus")[0];
  }

  /** Run the REAL handler twice against the same fake db. */
  async function pushTwice(
    first: Record<string, unknown>,
    second: Record<string, unknown>,
  ) {
    const ctx = makeCtx();
    await invoke(cmdDroneStatus.pushStatus, ctx, first);
    await invoke(cmdDroneStatus.pushStatus, ctx, second);
    const rows = ctx.db.rows("cmd_droneStatus");
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  it("persists every local-surface field the agent sends", async () => {
    const row = await push({
      ...BASE,
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
    });
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

  it("sets updatedAt server-side, never from args", async () => {
    const before = Date.now();
    const row = await push({ ...BASE, updatedAt: 1 });
    expect(typeof row.updatedAt).toBe("number");
    expect(row.updatedAt as number).toBeGreaterThanOrEqual(before);
  });

  it("preserves the identifiers alongside the telemetry", async () => {
    const row = await push({ ...BASE, deviceId: "drone-c", lcdActivePage: "video" });
    expect(row.deviceId).toBe("drone-c");
    expect(row.version).toBe("0.18.4");
    expect(row.uptimeSeconds).toBe(60);
    expect(row.lcdActivePage).toBe("video");
  });

  // THE stale-cloud-status defect. The handler used to patch with `{...args}`,
  // and Convex drops undefined-valued keys when serializing mutation
  // ARGUMENTS — so a field the agent stops sending is simply absent from
  // `args`, the spread does not carry the key, and `db.patch` leaves the old
  // value in place forever. A remote operator saw a dead radio as healthy,
  // with a plausible RSSI and a fresh `updatedAt`.
  it("CLEARS a field the agent stops sending", async () => {
    const row = await pushTwice(
      { ...BASE, uiTheme: "dark", lcdActivePage: "dashboard" },
      { ...BASE },
    );
    expect(row.uiTheme).toBeUndefined();
    expect(row.lcdActivePage).toBeUndefined();
  });

  it("CLEARS the radio block when the radio service goes away", async () => {
    const radio = {
      state: "up",
      iface: "wlan1",
      driver: "rtl88xxau",
      channel: 161,
      freqMhz: 5805,
      bandwidthMhz: 20,
      txPowerDbm: 20,
      txPowerMaxDbm: 30,
      topology: "unicast",
      rssiDbm: -40,
      bitrateKbps: 4057,
      fecRecovered: 0,
      fecLost: 0,
      packetsLost: 0,
    };
    const row = await pushTwice({ ...BASE, radio }, { ...BASE });
    expect(row.radio).toBeUndefined();
  });

  it("stores an EMPTY peer list as empty, not as the previous list", async () => {
    // An empty list is a real reading: the node has no linked peers right
    // now. The relay used to translate it into "no update", so the last
    // non-empty list persisted.
    const row = await pushTwice(
      { ...BASE, linkedPeers: [{ deviceId: "gs-1", role: "ground-station" }] },
      { ...BASE, linkedPeers: [] },
    );
    expect(row.linkedPeers).toEqual([]);
  });
});
