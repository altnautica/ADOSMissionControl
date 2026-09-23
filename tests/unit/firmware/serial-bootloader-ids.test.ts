/**
 * Unit tests for the serial-bootloader VID/PID matcher and filter builder.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  matchesBootloader,
  toSerialFilters,
  PX4_BOOTLOADER_IDS,
  ARDUPILOT_BOOTLOADER_IDS,
} from "@/lib/serial-bootloader-ids";

describe("matchesBootloader", () => {
  it("matches a PX4-family vendor regardless of product id (vendor-only entry)", () => {
    expect(matchesBootloader({ vendorId: 0x26ac, productId: 0x0038 }, PX4_BOOTLOADER_IDS)).toBe(true);
    expect(matchesBootloader({ vendorId: 0x3185, productId: 0x1234 }, PX4_BOOTLOADER_IDS)).toBe(true);
  });

  it("requires an exact product id for the shared open-source vendor", () => {
    expect(matchesBootloader({ vendorId: 0x1209, productId: 0x5740 }, ARDUPILOT_BOOTLOADER_IDS)).toBe(true);
    expect(matchesBootloader({ vendorId: 0x1209, productId: 0x9999 }, ARDUPILOT_BOOTLOADER_IDS)).toBe(false);
  });

  it("returns false when the vendor id is unknown or absent", () => {
    expect(matchesBootloader({ vendorId: 0x1234, productId: 0x5678 }, PX4_BOOTLOADER_IDS)).toBe(false);
    expect(matchesBootloader({}, PX4_BOOTLOADER_IDS)).toBe(false);
  });
});

// USB vendor ids: 0x2DAE is CubePilot, 0x3162 Holybro, 0x27AC VRBrain.
describe("vendor tables", () => {
  it("finds a CubeBlack in the ArduPilot bootloader (0x2DAE:0x1001)", () => {
    expect(matchesBootloader({ vendorId: 0x2dae, productId: 0x1001 }, ARDUPILOT_BOOTLOADER_IDS)).toBe(true);
    expect(matchesBootloader({ vendorId: 0x2dae, productId: 0x1002 }, ARDUPILOT_BOOTLOADER_IDS)).toBe(true);
    expect(matchesBootloader({ vendorId: 0x2dae, productId: 0x1005 }, ARDUPILOT_BOOTLOADER_IDS)).toBe(true);
  });

  it("finds a Holybro board (0x3162) in the PX4 bootloader", () => {
    expect(matchesBootloader({ vendorId: 0x3162, productId: 0x004b }, PX4_BOOTLOADER_IDS)).toBe(true);
  });

  it("offers the CubePilot and Holybro vendors in the PX4 picker, not the VRBrain vendor", () => {
    const vendors = toSerialFilters(PX4_BOOTLOADER_IDS).map((f) => f.usbVendorId);
    expect(vendors).toEqual(expect.arrayContaining([0x2dae, 0x3162]));
    expect(vendors).not.toContain(0x27ac);
    expect(vendors).not.toContain(0x3612);
  });
});

describe("toSerialFilters", () => {
  it("emits vendor-only and vendor+product filters", () => {
    const filters = toSerialFilters([
      { vendorId: 0x26ac, label: "x" },
      { vendorId: 0x1209, productId: 0x5740, label: "y" },
    ]);
    expect(filters).toEqual([
      { usbVendorId: 0x26ac },
      { usbVendorId: 0x1209, usbProductId: 0x5740 },
    ]);
  });
});
