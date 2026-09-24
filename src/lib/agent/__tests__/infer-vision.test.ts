/**
 * @module infer-vision.test
 * @description Unit tests for the vision-capability inference path and the
 * cmd_droneStatus → heartbeat-extras → inferred-summary mapping the cloud
 * bridge relies on to render the per-drone Vision tab.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { inferCapabilities } from "../infer-capabilities";
import type { AgentStatus } from "../types";
import { buildHeartbeatExtras } from "@/components/command/bridges/status-mapper";

function statusWithSoc(soc: string): AgentStatus {
  return {
    version: "0.47.0",
    uptime_seconds: 100,
    board: {
      name: "Test Board",
      model: "",
      tier: 2,
      ram_mb: 8192,
      cpu_cores: 8,
      vendor: "",
      soc,
      arch: "arm64",
      hw_video_codecs: [],
    },
    health: {
      cpu_percent: 5,
      memory_percent: 20,
      disk_percent: 10,
      temperature: 40,
      timestamp: new Date().toISOString(),
    },
    fc_connected: false,
    fc_port: "",
    fc_baud: 0,
  };
}

describe("inferCapabilities vision flag", () => {
  it("sets visionAvailable=true when the agent advertises a backend", () => {
    // A board with no NPU still gets the flag when the agent advertises
    // the vision surface — the advertised surface is authoritative.
    const caps = inferCapabilities(statusWithSoc("BCM2712"), [], {
      visionBackend: "mock",
      visionActiveModel: null,
    });
    expect(caps).not.toBeNull();
    expect(caps!.visionAvailable).toBe(true);
    // engine present but idle → summary exists with a null active model
    expect(caps!.visionSummary).toBeDefined();
    expect(caps!.visionSummary!.backend).toBe("mock");
    expect(caps!.visionSummary!.activeModel).toBeNull();
  });

  it("carries the live summary metrics through when advertised", () => {
    const caps = inferCapabilities(statusWithSoc("RK3588"), [], {
      visionBackend: "rknn",
      visionActiveModel: "com.example.weeds",
      visionDetectionsPerSec: 12.5,
      visionFps: 24,
    });
    expect(caps!.visionAvailable).toBe(true);
    expect(caps!.visionSummary).toEqual({
      activeModel: "com.example.weeds",
      backend: "rknn",
      detectionsPerSec: 12.5,
      fps: 24,
    });
  });

  it("falls back to NPU-bearing SoC when the surface is not advertised", () => {
    // RK3588 has a real NPU; no advertised surface, but the hardware
    // prerequisite is present → vision-capable.
    const caps = inferCapabilities(statusWithSoc("RK3588"), []);
    expect(caps!.compute.npu_available).toBe(true);
    expect(caps!.visionAvailable).toBe(true);
    // No advertised surface → no fabricated summary
    expect(caps!.visionSummary).toBeUndefined();
  });

  it("reports no accelerator and no vision on a Pi-class board with no surface", () => {
    // A Broadcom Pi SoC has no NPU: inference must not claim one (no
    // `npu_available`, no RKNN runtime) or light the vision tab.
    for (const soc of ["BCM2711", "BCM2712"]) {
      const caps = inferCapabilities(statusWithSoc(soc), []);
      expect(caps!.compute.npu_available).toBe(false);
      expect(caps!.compute.npu_runtime).toBeNull();
      expect(caps!.compute.npu_tops).toBe(0);
      expect(caps!.hasAccelerator).toBe(false);
      expect(caps!.visionAvailable).toBeUndefined();
      expect(caps!.visionSummary).toBeUndefined();
    }
  });
});

describe("cmd_droneStatus vision mapping", () => {
  // The vision-summary fields ARE on the cloud wire: Convex declares them as
  // `cmd_droneStatus` columns and `convex/http.ts` picks them off the ingest
  // body. The bridge used to discard them one layer from their consumers, so
  // `visionAvailable` fell back to "is this SoC in the NPU table with
  // TOPS > 0" and a Pi-class drone running a USB/CPU vision engine showed the
  // Vision tab over LAN and not over the cloud relay.
  it("reads the vision summary fields off a cloud row", () => {
    const extras = buildHeartbeatExtras({
      visionActiveModel: "com.example.weeds",
      visionBackend: "ort",
      visionDetectionsPerSec: 8,
      visionFps: 15,
    });
    expect(extras.inferOverrides?.visionActiveModel).toBe("com.example.weeds");
    expect(extras.inferOverrides?.visionBackend).toBe("ort");
    expect(extras.inferOverrides?.visionDetectionsPerSec).toBe(8);
    expect(extras.inferOverrides?.visionFps).toBe(15);
  });

  it("lights up vision from the advertised surface on a board with no NPU", () => {
    // BCM2711 (Pi 4) is not in the NPU table, so hardware inference alone
    // leaves vision unknown. The agent advertising an engine is the fact that
    // decides it — and that fact now survives the relay.
    const extras = buildHeartbeatExtras({
      visionActiveModel: "com.example.people",
      visionBackend: "rknn",
      visionDetectionsPerSec: 30,
      visionFps: 30,
    });
    const caps = inferCapabilities(
      statusWithSoc("BCM2711"),
      [],
      extras.inferOverrides,
    );
    expect(caps!.visionAvailable).toBe(true);
    expect(caps!.visionSummary).toMatchObject({
      activeModel: "com.example.people",
      backend: "rknn",
    });
  });

  it("leaves vision overrides undefined when the row omits them", () => {
    const extras = buildHeartbeatExtras({ version: "0.47.0" });
    expect(extras.inferOverrides?.visionActiveModel).toBeUndefined();
    expect(extras.inferOverrides?.visionBackend).toBeUndefined();
    const caps = inferCapabilities(
      statusWithSoc("BCM2712"),
      [],
      extras.inferOverrides,
    );
    expect(caps!.visionAvailable).toBeUndefined();
    expect(caps!.visionSummary).toBeUndefined();
  });
});
