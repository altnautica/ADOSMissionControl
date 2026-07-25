/**
 * @license GPL-3.0-only
 *
 * Unit tests for mapCloudStatus: the transform that turns a cmd_droneStatus
 * cloud heartbeat row into the AgentStatus shape the GCS consumes. Focused on
 * the FC-variant surface so a cloud-relayed Betaflight/iNav FC drives the MSP
 * adapter + MSP relay lane the same way the LAN-direct path does.
 */

import { describe, it, expect } from "vitest";
import { mapCloudStatus } from "../agent-status";

// updatedAt is required (it seeds the health timestamp); every row carries it.
const base = { updatedAt: 1_000 } as const;

describe("mapCloudStatus — fcVariant", () => {
  it("maps a betaflight heartbeat's fcVariant to fc_variant", () => {
    const status = mapCloudStatus({ ...base, fcVariant: "betaflight", fcConnected: true });
    expect(status.fc_variant).toBe("betaflight");
  });

  it("maps an inav heartbeat's fcVariant to fc_variant", () => {
    const status = mapCloudStatus({ ...base, fcVariant: "inav" });
    expect(status.fc_variant).toBe("inav");
  });

  it("leaves fc_variant undefined when the heartbeat omits fcVariant (older agent)", () => {
    const status = mapCloudStatus({ ...base });
    expect(status.fc_variant).toBeUndefined();
  });

  it("leaves fc_variant undefined for a non-string fcVariant", () => {
    const status = mapCloudStatus({ ...base, fcVariant: 42 });
    expect(status.fc_variant).toBeUndefined();
  });
});

describe("mapCloudStatus — fcFirmware", () => {
  it("maps an ArduPilot heartbeat's fcFirmware to fc_firmware", () => {
    const status = mapCloudStatus({ ...base, fcFirmware: "ardupilot", fcConnected: true });
    expect(status.fc_firmware).toBe("ardupilot");
  });

  it("maps a PX4 heartbeat's fcFirmware to fc_firmware", () => {
    const status = mapCloudStatus({ ...base, fcFirmware: "px4", fcConnected: true });
    expect(status.fc_firmware).toBe("px4");
  });

  it("leaves fc_firmware undefined when the heartbeat omits it (older agent)", () => {
    const status = mapCloudStatus({ ...base });
    expect(status.fc_firmware).toBeUndefined();
  });

  it("leaves fc_firmware undefined for a non-string fcFirmware", () => {
    const status = mapCloudStatus({ ...base, fcFirmware: 42 });
    expect(status.fc_firmware).toBeUndefined();
  });
});

describe("mapCloudStatus — resource readings", () => {
  it("maps the reported utilisation percentages", () => {
    const status = mapCloudStatus({
      ...base,
      cpuPercent: 34.2,
      memoryPercent: 61,
      diskPercent: 42.5,
    });

    expect(status.health.cpu_percent).toBeCloseTo(34.2);
    expect(status.health.memory_percent).toBe(61);
    expect(status.health.disk_percent).toBeCloseTo(42.5);
  });

  it("leaves the percentages absent when the heartbeat carried no resource block", () => {
    // The row exists but reported no load. Coercing to 0 would render a solid
    // "CPU 0.0%", indistinguishable from a genuinely idle board.
    const status = mapCloudStatus({ ...base });

    expect(status.health.cpu_percent).toBeUndefined();
    expect(status.health.memory_percent).toBeUndefined();
    expect(status.health.disk_percent).toBeUndefined();
  });

  it("keeps a genuine zero reading, which is a measurement", () => {
    const status = mapCloudStatus({ ...base, cpuPercent: 0 });
    expect(status.health.cpu_percent).toBe(0);
  });

  it("treats a non-numeric reading as absent rather than as zero", () => {
    const status = mapCloudStatus({ ...base, cpuPercent: "34", memoryPercent: null });

    expect(status.health.cpu_percent).toBeUndefined();
    expect(status.health.memory_percent).toBeUndefined();
  });

  it("treats a NaN reading as absent", () => {
    const status = mapCloudStatus({ ...base, diskPercent: Number.NaN });
    expect(status.health.disk_percent).toBeUndefined();
  });

  it("still reports temperature as null when absent, matching its prior contract", () => {
    const status = mapCloudStatus({ ...base });
    expect(status.health.temperature).toBeNull();
  });
});
