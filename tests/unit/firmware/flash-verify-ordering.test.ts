/**
 * Regression tests for the flash verify ordering fix.
 *
 * The bug: a firmware flasher leaves the bootloader / reboots the board as the
 * last step of flash() (DFU manifest, ROM GO, PX4 reboot). A separate verify()
 * pass that ran AFTER flash() therefore talked to a rebooted, disconnected
 * device — DFU threw "controlTransferOut ... A transfer error has occurred" —
 * and a fully-successful flash was reported as a failure.
 *
 * The fix folds verification (read-back + compare) into flash(), BEFORE the
 * device leaves the bootloader. These tests pin that behaviour on the DFU path
 * (the reported case): verify runs before leave(), the flow reaches `done` even
 * when the device disconnects afterward, a byte mismatch is a real failure, and
 * an un-readable-back board (transfer error, not a mismatch) still succeeds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlashProgress } from "@/lib/protocol/firmware/types";

// Mock the DFuSe descriptor readers so the flasher gets a deterministic layout
// and transfer size without parsing real USB descriptors.
vi.mock("@/lib/protocol/firmware/stm32-dfu-descriptors", () => ({
  getFlashLayout: vi.fn(async () => ({
    name: "Internal Flash",
    baseAddress: 0x08000000,
    sectors: [{ address: 0x08000000, size: 0x20000, count: 1, properties: "g" }],
    totalSize: 0x20000,
  })),
  getTransferSize: vi.fn(async () => 2048),
}));

import { STM32DfuFlasher } from "@/lib/protocol/firmware/stm32-dfu";

const DFU_DNLOAD = 0x01;
const DFU_UPLOAD = 0x02;
const DFU_GETSTATUS = 0x03;
const FW_BYTES = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
const FW_ADDR = 0x08000000;

type Op = { dir: "in" | "out"; request: number; len?: number };

/**
 * A minimal fake WebUSB DFU device. GETSTATUS always reports dfuIDLE(2)/status OK
 * so the poll loops settle. UPLOAD behaviour is injected per test.
 */
function makeFakeDevice(uploadBehaviour: () => Uint8Array): {
  device: USBDevice;
  ops: Op[];
} {
  const ops: Op[] = [];
  const dfuAlt = {
    alternateSetting: 0,
    interfaceClass: 0xfe,
    interfaceSubclass: 0x01,
    interfaceName: "@Internal Flash /0x08000000/01*128Kg",
  };
  const configuration = {
    interfaces: [{ interfaceNumber: 0, alternates: [dfuAlt] }],
  };
  const device = {
    opened: false,
    configuration,
    async open() { (this as { opened: boolean }).opened = true; },
    async close() { (this as { opened: boolean }).opened = false; },
    async selectConfiguration() {},
    async claimInterface() {},
    async releaseInterface() {},
    async selectAlternateInterface() {},
    async controlTransferIn(setup: { request: number }, _len: number) {
      ops.push({ dir: "in", request: setup.request });
      if (setup.request === DFU_GETSTATUS) {
        const b = new Uint8Array(6); // status=0(OK), pollTimeout=0, state=2(dfuIDLE)
        b[4] = 2;
        return { status: "ok", data: new DataView(b.buffer) };
      }
      if (setup.request === DFU_UPLOAD) {
        const out = uploadBehaviour(); // may throw
        return { status: "ok", data: new DataView(out.buffer, out.byteOffset, out.byteLength) };
      }
      return { status: "ok", data: new DataView(new ArrayBuffer(0)) };
    },
    async controlTransferOut(setup: { request: number }, data?: BufferSource) {
      const len = data ? (data as ArrayBufferView).byteLength : undefined;
      ops.push({ dir: "out", request: setup.request, len });
      return { status: "ok", bytesWritten: len ?? 0 };
    },
  };
  return { device: device as unknown as USBDevice, ops };
}

function firmware() {
  return { blocks: [{ address: FW_ADDR, data: FW_BYTES }], totalBytes: FW_BYTES.length };
}

describe("STM32DfuFlasher flash() — verify before leave()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reaches `done` and runs the read-back (UPLOAD) BEFORE the leave DNLOAD", async () => {
    const { device, ops } = makeFakeDevice(() => FW_BYTES);
    const flasher = new STM32DfuFlasher(device);
    const phases: string[] = [];
    const onProgress = (p: FlashProgress) => phases.push(p.phase);

    await flasher.flash(firmware(), onProgress);

    // The flow completed successfully.
    expect(phases).toContain("verifying");
    expect(phases[phases.length - 1]).toBe("done");
    expect(phases).not.toContain("error");

    // The read-back UPLOAD happened, and it happened before the final
    // zero-length DNLOAD (the leave/manifest that reboots the board).
    const uploadIdx = ops.findIndex((o) => o.dir === "in" && o.request === DFU_UPLOAD);
    const leaveIdx = ops.findIndex((o) => o.dir === "out" && o.request === DFU_DNLOAD && o.len === undefined);
    expect(uploadIdx).toBeGreaterThanOrEqual(0);
    expect(leaveIdx).toBeGreaterThanOrEqual(0);
    expect(uploadIdx).toBeLessThan(leaveIdx);
  });

  it("does NOT read back or fail when verify is disabled", async () => {
    const { device, ops } = makeFakeDevice(() => {
      throw new Error("UPLOAD must not be called when verify is off");
    });
    const flasher = new STM32DfuFlasher(device);
    const phases: string[] = [];

    await flasher.flash(firmware(), (p) => phases.push(p.phase), undefined, undefined, { verify: false });

    expect(phases[phases.length - 1]).toBe("done");
    expect(ops.some((o) => o.dir === "in" && o.request === DFU_UPLOAD)).toBe(false);
  });

  it("FAILS on a genuine byte mismatch (real corruption)", async () => {
    const { device } = makeFakeDevice(() => new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    const flasher = new STM32DfuFlasher(device);

    await expect(flasher.flash(firmware(), () => {})).rejects.toThrow(/Verification failed at/);
  });

  it("SUCCEEDS with an unverified warning when the read-back transfer itself errors", async () => {
    // e.g. a bootloader that blocks DFU_UPLOAD under readout protection: every
    // write block was accepted, so the flash completes but is reported as not
    // compared rather than verified.
    const { device } = makeFakeDevice(() => {
      throw new Error("Failed to execute 'controlTransferIn' on 'USBDevice': A transfer error has occurred.");
    });
    const flasher = new STM32DfuFlasher(device);
    const phases: string[] = [];
    const logs: Array<{ level: string; message: string }> = [];

    await flasher.flash(firmware(), (p) => phases.push(p.phase), undefined, (level, message) => logs.push({ level, message }));

    expect(phases[phases.length - 1]).toBe("done");
    expect(phases).not.toContain("error");
    expect(logs.some((l) => l.level === "warning" && /read-back/.test(l.message))).toBe(true);
  });
});
