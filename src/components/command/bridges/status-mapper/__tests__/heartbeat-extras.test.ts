/**
 * @license GPL-3.0-only
 *
 * A3 regression for buildHeartbeatExtras — the perception offload-target field.
 * The tier + offload target travel together on the wire, but the Rust beacon
 * OMITS the target (skip_serializing_if) when there is none. So when the tier IS
 * present but the target is absent, the drone stopped offloading and the target
 * must map to null (cleared), NOT undefined (keep-prior) — otherwise a card
 * keeps naming a stale workstation (Rule 44). An absent target with an ALSO
 * absent tier is a sparse tick and keeps prior (undefined).
 */

import { describe, it, expect } from "vitest";
import { buildHeartbeatExtras } from "../heartbeat-extras";

describe("buildHeartbeatExtras — perception offload target", () => {
  it("clears the target (null) when a later heartbeat sends a tier but no target", () => {
    // First heartbeat: offloading to a workstation.
    const first = buildHeartbeatExtras({
      perceptionTier: "offload",
      perceptionOffloadTarget: "workstation.local:8092",
    });
    expect(first.perceptionTier).toBe("offload");
    expect(first.perceptionOffloadTarget).toBe("workstation.local:8092");

    // Second heartbeat: back to local — the tier travels, the target field is
    // omitted. The mapped target must be null (cleared), not undefined.
    const second = buildHeartbeatExtras({ perceptionTier: "local" });
    expect(second.perceptionTier).toBe("local");
    expect(second.perceptionOffloadTarget).toBeNull();
  });

  it("keeps prior (undefined) when neither tier nor target is present", () => {
    const extras = buildHeartbeatExtras({ version: "1.0.0" });
    expect(extras.perceptionTier).toBeUndefined();
    expect(extras.perceptionOffloadTarget).toBeUndefined();
  });

  it("passes an explicit string target through", () => {
    const extras = buildHeartbeatExtras({
      perceptionTier: "offload",
      perceptionOffloadTarget: "10.0.0.5:8092",
    });
    expect(extras.perceptionOffloadTarget).toBe("10.0.0.5:8092");
  });

  it("passes an explicit null target through as cleared", () => {
    const extras = buildHeartbeatExtras({
      perceptionTier: "local",
      perceptionOffloadTarget: null,
    });
    expect(extras.perceptionOffloadTarget).toBeNull();
  });
});

describe("buildHeartbeatExtras — capability fields on the cloud wire", () => {
  it("carries the vision block instead of dropping it", () => {
    // `inferCapabilities` decides `visionAvailable` from the PRESENCE of
    // visionBackend / visionActiveModel. With both dropped it fell back to
    // "is this SoC in the NPU table with TOPS > 0", so a Pi-class drone
    // running a USB/CPU vision engine showed the Vision tab over LAN and not
    // over the cloud relay.
    const extras = buildHeartbeatExtras({
      visionActiveModel: "yolov8n",
      visionBackend: "ort",
      visionDetectionsPerSec: 12.5,
      visionFps: 24,
    });
    expect(extras.inferOverrides).toMatchObject({
      visionActiveModel: "yolov8n",
      visionBackend: "ort",
      visionDetectionsPerSec: 12.5,
      visionFps: 24,
    });
  });

  it("forwards an idle vision engine as present, not absent", () => {
    // A null active model still advertises that the engine EXISTS. Mapping it
    // to undefined would read as "this agent has no vision engine".
    const extras = buildHeartbeatExtras({
      visionActiveModel: null,
      visionBackend: "mock",
    });
    expect(extras.inferOverrides?.visionActiveModel).toBeNull();
    expect(extras.inferOverrides?.visionBackend).toBe("mock");
  });

  it("leaves an absent field undefined so the store keeps the prior value", () => {
    // The agent omits a key entirely when its sidecar is missing or stale.
    // Absent must mean UNKNOWN, never false/empty.
    const extras = buildHeartbeatExtras({ version: "1.0.0" });
    expect(extras.inferOverrides?.visionBackend).toBeUndefined();
    expect(extras.inferOverrides?.videoRecording).toBeUndefined();
    expect(extras.inferOverrides?.displayType).toBeUndefined();
    expect(extras.canBuses).toBeUndefined();
  });

  it("carries the LCD, local-decoder and display fields", () => {
    const extras = buildHeartbeatExtras({
      lcdActivePage: "telemetry",
      lcdRotation: 180,
      videoLocalDecoderActive: true,
      videoLocalDecoderType: "v4l2m2m",
      videoLocalDecoderFps: 30,
      videoRecording: false,
      displayType: "lcd",
    });
    expect(extras.inferOverrides).toMatchObject({
      lcdActivePage: "telemetry",
      lcdRotation: 180,
      videoLocalDecoderActive: true,
      videoLocalDecoderType: "v4l2m2m",
      videoLocalDecoderFps: 30,
      videoRecording: false,
      displayType: "lcd",
    });
  });

  it("carries the real canBuses inventory instead of a hardcoded undefined", () => {
    const extras = buildHeartbeatExtras({
      canBuses: [
        { port: 1, driver: 1, bitrate: 1_000_000, protocol: 1 },
        { port: 2, driver: 0, bitrate: 500_000, protocol: 0 },
      ],
    });
    expect(extras.canBuses).toEqual([
      { port: 1, driver: 1, bitrate: 1_000_000, protocol: 1 },
      { port: 2, driver: 0, bitrate: 500_000, protocol: 0 },
    ]);
  });

  it("reports a malformed canBuses entry as unknown, never a partial inventory", () => {
    // Every field is read as a number downstream and the CAN surface gate
    // counts the entries, so half an inventory would render NaN and read as
    // "this node has one bus".
    const extras = buildHeartbeatExtras({
      canBuses: [{ port: 1, driver: 1, bitrate: 1_000_000, protocol: 1 }, { port: "2" }],
    });
    expect(extras.canBuses).toBeUndefined();
  });

  it("ignores a wrong-typed wire value rather than coercing it", () => {
    const extras = buildHeartbeatExtras({
      visionFps: "24",
      videoRecording: "true",
      displayType: 3,
    });
    expect(extras.inferOverrides?.visionFps).toBeUndefined();
    expect(extras.inferOverrides?.videoRecording).toBeUndefined();
    expect(extras.inferOverrides?.displayType).toBeUndefined();
  });
});
