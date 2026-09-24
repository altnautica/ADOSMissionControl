/**
 * Verifies permissionsToChips(): the manifest-declaration to chip-label
 * resolver the plugin install dialog uses to summarise the hardware a
 * plugin needs. Chips come only from explicit declarations, and the
 * first-party manifests must map to the hardware they really use.
 *
 * @license GPL-3.0-only
 */

import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import { permissionsToChips, type CapabilityChip } from "@/lib/plugins/capability-chips";

const ids = (chips: CapabilityChip[]) => chips.map((c) => c.id);

describe("permissionsToChips", () => {
  it("returns empty list for a GCS-only plugin with no hardware permissions", () => {
    expect(permissionsToChips(["ui.slot.drone-detail-tab", "telemetry.subscribe"])).toEqual([]);
  });

  it("maps each camera-binding permission to one Camera chip", () => {
    for (const p of [
      "hardware.usb.uvc",
      "hardware.camera.csi",
      "sensor.camera.register",
      "mavlink.component.camera",
      "vision.frame.read",
    ]) {
      expect(ids(permissionsToChips([p])), p).toEqual(["camera"]);
    }
    expect(
      ids(permissionsToChips(["hardware.camera.csi", "hardware.usb.uvc", "sensor.camera.register"])),
    ).toEqual(["camera"]);
  });

  it("maps a declared hardware_requirements camera to a Camera chip", () => {
    expect(
      ids(permissionsToChips([], { hardwareRequirements: { cameras: "USB UVC camera" } })),
    ).toEqual(["camera"]);
    expect(permissionsToChips([], { hardwareRequirements: { cameras: "  " } })).toEqual([]);
  });

  it("maps model registration and compute streams to an NPU chip", () => {
    expect(ids(permissionsToChips(["vision.model.register"]))).toEqual(["npu"]);
    expect(ids(permissionsToChips(["compute.stream.open"]))).toEqual(["npu"]);
  });

  it("does not treat VIO as an NPU requirement", () => {
    expect(permissionsToChips(["mavlink.component.vio"])).toEqual([]);
  });

  it("maps process.spawn plus an NPU runtime attribution to an NPU chip", () => {
    expect(
      ids(permissionsToChips(["process.spawn"], { vendorAttribution: [{ name: "RKNN runtime" }] })),
    ).toEqual(["npu"]);
    expect(
      permissionsToChips(["process.spawn"], { vendorAttribution: [{ name: "libusb" }] }),
    ).toEqual([]);
  });

  it("never derives GPS or IMU from telemetry reads", () => {
    expect(permissionsToChips(["telemetry.read"])).toEqual([]);
  });

  it("maps sensor.imu.register to an IMU chip", () => {
    expect(ids(permissionsToChips(["sensor.imu.register"]))).toEqual(["imu"]);
  });

  it("does not treat raw USB access as a thermal camera", () => {
    expect(permissionsToChips(["hardware.usb"])).toEqual([]);
  });

  it("maps a declared thermal telemetry field to a Thermal chip", () => {
    expect(ids(permissionsToChips([], { telemetryFields: ["thermal"] }))).toEqual(["thermal"]);
  });

  it("maps sensor.lidar.register to a LIDAR chip", () => {
    expect(ids(permissionsToChips(["sensor.lidar.register"]))).toEqual(["lidar"]);
  });

  it("renders chips in the canonical order with stable labels", () => {
    const chips = permissionsToChips(
      ["sensor.lidar.register", "sensor.imu.register", "vision.model.register", "hardware.camera.csi"],
      { telemetryFields: ["thermal"] },
    );
    expect(ids(chips)).toEqual(["camera", "npu", "imu", "thermal", "lidar"]);
    expect(chips.map((c) => c.label)).toEqual(["Camera", "NPU", "IMU", "Thermal", "LIDAR"]);
  });
});

// The first-party manifests live in the sibling extensions checkout. A
// standalone GCS clone skips this block rather than failing.
const EXTENSIONS_DIR = path.resolve(__dirname, "..", "..", "..", "ADOSExtensions", "extensions");

const FIRST_PARTY_CHIPS: ReadonlyArray<[string, string[]]> = [
  ["vision-nav", ["camera"]],
  ["thermal-camera-flir-lepton-usb", ["camera", "thermal"]],
  ["siyi-pod", ["camera"]],
  ["follow-me", ["camera"]],
  ["mavlink-gimbal-v2", []],
];

describe("permissionsToChips on first-party manifests", () => {
  for (const [dir, expected] of FIRST_PARTY_CHIPS) {
    const file = path.join(EXTENSIONS_DIR, dir, "manifest.yaml");
    const maybeIt = fs.existsSync(file) ? it : it.skip;
    maybeIt(`${dir} shows ${expected.join(", ") || "no chips"}`, () => {
      const parsed = parseManifestYaml(fs.readFileSync(file, "utf-8"));
      const chips = permissionsToChips(
        parsed.permissions.map((p) => p.id),
        {
          hardwareRequirements: parsed.hardwareRequirements,
          telemetryFields: parsed.telemetryFields,
        },
      );
      expect(ids(chips)).toEqual(expected);
    });
  }
});
