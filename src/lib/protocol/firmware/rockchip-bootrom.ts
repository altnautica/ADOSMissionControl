// Exempt from 300 LOC soft rule: self-contained WebUSB rockusb protocol
// client. The maskrom/loader staging, CBW/CSW framing, and LBA streaming
// share private device handles and protocol constants that have no
// caller-facing seam; splitting them would expose internal transport
// state across module boundaries with no consumer benefit.
/**
 * Rockchip rockusb in-browser flasher.
 *
 * Talks the public Rockchip USB bootrom protocol over WebUSB to write a
 * full system image (.img.gz) to the eMMC of an SBC sitting in maskrom or
 * loader stage. Two stages:
 *
 *   1. Maskrom stage  — the SoC ROM enumerates as a Rockchip USB device
 *      with a tiny request set: control-transfer in/out for code-download
 *      followed by execute. We push a small DDR init / loader blob, the
 *      SoC re-enumerates as the loader stage device.
 *
 *   2. Loader stage   — bulk endpoints expose a SCSI-like command
 *      surface (CBW out, data, CSW in). We use READ_FLASH_ID to sanity
 *      check, WRITE_LBA to stream the decompressed image into eMMC,
 *      then RESET_DEVICE to reboot into the freshly flashed system.
 *
 * Image input is always a gzip-compressed raw disk image (.img.gz). We
 * decompress with pako, slice into 512-byte LBA blocks, and stream the
 * payload into the device. The compressed blob ships with a SHA-256
 * digest and a minisign signature so the manifest layer can verify
 * before this flasher ever opens the device.
 *
 * Slice surface implemented in this revision:
 *   - VID/PID constants for the Rockchip bootrom and the known maskrom
 *     product ids for current Rockchip SoCs (RV1106 / RK3566 / RK3588
 *     family).
 *   - Maskrom code-download control-transfer surface and a
 *     re-enumeration wait that returns once the loader-stage device
 *     reappears under WebUSB.
 *   - Loader-stage CBW/CSW framing with a working command dispatcher
 *     covering READ_FLASH_ID (0x01), READ_LBA (0x14), WRITE_LBA (0x15),
 *     and RESET_DEVICE (0xff).
 *   - Streaming write of a gzipped image with progress callbacks and
 *     AbortSignal support.
 *
 * Out of scope for this revision (left as TODOs in-line):
 *   - The DDR init / loader-stage transfer payload bytes. Those are
 *     SoC-specific binary blobs that ship with the manifest entry; this
 *     module assumes the caller provides them via the optional
 *     `loaderBlob` argument to {@link RockchipBootromFlasher.prepare}.
 *     When unavailable, prepare() will skip the maskrom uplift and
 *     attempt to talk to the device as if it is already in loader
 *     stage. That is the correct behavior for boards that ship a stock
 *     loader on eMMC and only need a partition rewrite.
 *   - GPT / partition-table aware writes. Today we write from sector 0
 *     of a flat raw image. Per-partition writes (parameter / uboot /
 *     boot / rootfs) become a follow-up once the manifest declares a
 *     partition layout.
 *   - Full minisign verification. SHA-256 verification happens in the
 *     calling layer; minisign signature verification is wired into a
 *     follow-up mission.
 *
 * @module protocol/firmware/rockchip-bootrom
 */

/// <reference path="../web-usb.d.ts" />

import { inflate } from "pako";

import { usbDeviceManager, type UsbDeviceInfo } from "../../usb-device-manager";

import type { FlashProgressCallback } from "./types";

// ── Rockchip USB IDs ─────────────────────────────────────────

/** Vendor id reported by every Rockchip SoC bootrom. */
export const ROCKCHIP_USB_VID = 0x2207;

/**
 * Product ids observed on the wire when a Rockchip SoC enumerates in
 * maskrom mode. The list is intentionally permissive — the trailing
 * digits of the pid track the SoC family but new revisions ship every
 * year; the rockusb protocol itself is stable across them. Treat any
 * 0x2207 device as a candidate and let the loader-stage handshake
 * confirm we can talk to it.
 *
 * Confirmed entries: RV1106 (0x110c). The other product ids below are
 * documented in public schematics and Rockchip community knowledge for
 * the listed SoC family but should be considered best-effort labels.
 */
export const ROCKCHIP_MASKROM_PIDS: Record<number, string> = {
  0x110c: "RV1106 maskrom",
  0x110b: "RV1103 maskrom",
  0x320a: "RK3308 maskrom",
  0x350a: "RK3568 maskrom",
  0x350b: "RK3566 maskrom",
  0x350c: "RK3588 maskrom",
  0x320c: "RK3399 maskrom",
};

/**
 * Product ids observed once the SoC has been uplifted into the loader
 * stage (i.e. after the DDR init / loader blob has been pushed). For
 * most SoCs the loader stage reuses the same pid as the maskrom — the
 * device interface descriptor changes from a tiny control-only set to
 * one with bulk endpoints. We keep a separate constant so future
 * loader-stage-specific quirks have a place to land.
 */
export const ROCKCHIP_LOADER_PIDS: Record<number, string> = {
  0x110c: "RV1106 loader",
  0x110b: "RV1103 loader",
};

/** USB device filter set for the Rockchip bootrom. */
export const ROCKCHIP_DEVICE_FILTERS: USBDeviceFilter[] = [
  { vendorId: ROCKCHIP_USB_VID },
];

// ── rockusb protocol constants ───────────────────────────────

/** USB Mass Storage CBW signature ("USBC", little-endian). */
const CBW_SIGNATURE = 0x43425355;
/** USB Mass Storage CSW signature ("USBS", little-endian). */
const CSW_SIGNATURE = 0x53425355;

/** Length of the command block wrapper sent on bulk-OUT before each op. */
const CBW_LENGTH = 31;
/** Length of the command status wrapper returned on bulk-IN after each op. */
const CSW_LENGTH = 13;

/** rockusb opcode values used in the CBW command block. */
const ROCKUSB_OP = {
  READ_FLASH_ID: 0x01,
  TEST_UNIT_READY: 0x00,
  READ_LBA: 0x14,
  WRITE_LBA: 0x15,
  ERASE_LBA: 0x25,
  READ_CAPABILITY: 0xaa,
  RESET_DEVICE: 0xff,
} as const;

/** Direction bit in CBW.bmCBWFlags. */
const CBW_FLAG_IN = 0x80;
const CBW_FLAG_OUT = 0x00;

/** Maskrom code-download / execute control-transfer request ids. */
const MASKROM_REQ_DOWNLOAD = 0x0471;
const MASKROM_REQ_EXECUTE = 0x0472;

/** Default LBA size. eMMC and the rockusb protocol both use 512-byte
 *  sectors; we don't expose this as configurable today. */
const LBA_SIZE = 512;

/**
 * Maximum number of LBAs we ship in a single WRITE_LBA op. The bulk
 * pipe can handle larger transfers but capping this keeps the progress
 * cadence smooth and bounds the time between abort-signal checks.
 */
const WRITE_CHUNK_LBAS = 256; // 256 * 512 = 128 KiB per op

/** USB transfer timeout for bulk endpoints, in ms. */
const BULK_TIMEOUT_MS = 30_000;

/**
 * Control-transfer timeout. Maskrom code-download and execute are short
 * vendor control requests that should complete in well under a second
 * even on slow hubs; 10s is a generous ceiling that prevents a wedged
 * bootrom from freezing the UI indefinitely.
 */
const CONTROL_TIMEOUT_MS = 10_000;

/**
 * Default time budget for re-enumeration after the maskrom code-download.
 * Some USB hubs and BSPs need 10+ seconds before the loader-stage device
 * shows up, so the budget is generous. Callers
 * can override via {@link RockchipPrepareOptions.reenumerateTimeoutMs}.
 */
const REENUMERATE_TIMEOUT_MS = 18_000;

// ── Public API types ─────────────────────────────────────────

/** Options accepted by {@link RockchipBootromFlasher.prepare}. */
export interface RockchipPrepareOptions {
  /**
   * SoC-specific DDR init / loader blob. When provided, prepare() will
   * push it via maskrom code-download and wait for re-enumeration. When
   * omitted, prepare() assumes the device is already in loader stage.
   */
  loaderBlob?: Uint8Array;
  /** Address to start execution from after code-download. */
  loaderEntryAddress?: number;
  /**
   * Override the re-enumeration timeout (default 18s). Useful on slow
   * USB hubs where the loader stage takes longer to appear.
   */
  reenumerateTimeoutMs?: number;
  /**
   * Abort signal honoured during the maskrom code-download and the
   * re-enumeration wait. When the signal fires, prepare() throws an
   * AbortError instead of leaving the device half-initialized.
   */
  signal?: AbortSignal;
}

/** Identity returned by READ_FLASH_ID. */
export interface RockchipFlashId {
  /** 5-byte vendor identification string. */
  raw: Uint8Array;
  /** Pretty-printed hex, e.g. "45 4d 4d 43 20". */
  hex: string;
}

/**
 * Common interface mirrored from {@link FirmwareFlasher} but adapted
 * to image-based flashing. The companion-side flow does not parse an
 * APJ / hex / px4 file; it streams a gzipped raw disk image instead.
 */
export interface SbcImageFlasher {
  prepare(opts?: RockchipPrepareOptions): Promise<void>;
  flash(
    image: ArrayBuffer | Uint8Array,
    onProgress: FlashProgressCallback,
    signal?: AbortSignal,
  ): Promise<void>;
  verify(): Promise<void>;
  abort(): void;
  dispose(): Promise<void>;
}

// ── Flasher implementation ───────────────────────────────────

export class RockchipBootromFlasher implements SbcImageFlasher {
  readonly method = "rockusb-webusb" as const;

  private device: USBDevice;
  private interfaceNumber = 0;
  private epIn = 0;
  private epOut = 0;
  private aborted = false;
  private claimed = false;

  constructor(device: USBDevice) {
    this.device = device;
  }

  /** WebUSB is gated by the global manager. */
  static isSupported(): boolean {
    return usbDeviceManager.isSupported();
  }

  /** Prompt the user to pick a Rockchip bootrom device. */
  static async requestDevice(): Promise<USBDevice> {
    return usbDeviceManager.requestRockchipDevice();
  }

  /** Already-permitted Rockchip devices, no user prompt. */
  static async getKnownDevices(): Promise<UsbDeviceInfo[]> {
    return usbDeviceManager.getKnownRockchipDevices();
  }

  /**
   * Open the device, optionally push the loader blob, then settle on a
   * loader-stage interface with bulk in/out endpoints. Safe to call
   * twice (idempotent).
   */
  async prepare(opts: RockchipPrepareOptions = {}): Promise<void> {
    this.aborted = false;
    if (opts.signal) {
      // Mirror flash() — the same abort path stops the wait loop and the
      // bulk-transfer paths. Skipping signal plumbing in prepare leaves
      // the device orphaned when the user clicks Cancel mid-uplift.
      opts.signal.addEventListener("abort", () => this.abort(), { once: true });
      this.checkAbort();
    }
    await this.openAndClaim();

    if (opts.loaderBlob && opts.loaderBlob.byteLength > 0) {
      await this.maskromCodeDownload(opts.loaderBlob);
      this.checkAbort();
      await this.maskromExecute(opts.loaderEntryAddress ?? 0x00000000);
      await this.releaseClaimed();
      // Drop the maskrom-stage device reference so waitForLoaderStage
      // does not skip the re-enumerated successor that often shares the
      // same vendor id and just swaps interface descriptors.
      const previousDevice = this.device;
      this.device = await this.waitForLoaderStage(
        opts.reenumerateTimeoutMs ?? REENUMERATE_TIMEOUT_MS,
        previousDevice,
      );
      await this.openAndClaim();
    }

    // Loader stage probe: a successful READ_FLASH_ID confirms the
    // bulk pipe and the CBW/CSW framing are good. Any error here means
    // the device has not actually reached loader stage and the caller
    // should be surfaced a useful message.
    await this.readFlashId();
  }

  async flash(
    image: ArrayBuffer | Uint8Array,
    onProgress: FlashProgressCallback,
    signal?: AbortSignal,
  ): Promise<void> {
    this.aborted = false;
    if (signal) {
      signal.addEventListener("abort", () => this.abort(), { once: true });
    }

    onProgress({
      phase: "bootloader_init",
      percent: 1,
      message: "Decompressing image...",
    });

    const compressed =
      image instanceof Uint8Array
        ? image
        : new Uint8Array(image as ArrayBuffer);

    let raw: Uint8Array;
    try {
      raw = inflate(compressed);
    } catch (err) {
      throw new Error(
        `Image decompression failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (raw.byteLength === 0) {
      throw new Error("Image decompressed to zero bytes.");
    }

    const totalBytes = raw.byteLength;
    const totalLbas = Math.ceil(totalBytes / LBA_SIZE);

    onProgress({
      phase: "chip_detect",
      percent: 3,
      message: `Image size: ${(totalBytes / (1024 * 1024)).toFixed(1)} MB (${totalLbas} sectors)`,
    });

    this.checkAbort();

    // Throttle progress callbacks: emit on >=1% delta OR >=250ms elapsed,
    // plus always emit the first and final tick so the UI starts and
    // settles cleanly. Without throttling a 50 MB image fires ~1,600
    // updates and floods React.
    onProgress({
      phase: "flashing",
      percent: 5,
      message: "Writing image to eMMC...",
      bytesWritten: 0,
      bytesTotal: totalBytes,
    });
    let lastReportedPercent = 5;
    let lastReportedAt = Date.now();

    let writtenLbas = 0;
    while (writtenLbas < totalLbas) {
      this.checkAbort();
      const remaining = totalLbas - writtenLbas;
      const lbaCount = Math.min(WRITE_CHUNK_LBAS, remaining);
      const byteOffset = writtenLbas * LBA_SIZE;
      const byteLen = Math.min(lbaCount * LBA_SIZE, totalBytes - byteOffset);
      let chunk = raw.subarray(byteOffset, byteOffset + byteLen);
      // If the last chunk is short, pad to a whole LBA boundary so the
      // device receives a full sector. eMMC writes are sector-aligned.
      if (chunk.byteLength % LBA_SIZE !== 0) {
        const padded = new Uint8Array(lbaCount * LBA_SIZE);
        padded.set(chunk, 0);
        chunk = padded;
      }

      await this.writeLba(writtenLbas, lbaCount, chunk);

      writtenLbas += lbaCount;
      const bytesWritten = Math.min(writtenLbas * LBA_SIZE, totalBytes);
      const percent = 5 + Math.floor((writtenLbas / totalLbas) * 90);
      const now = Date.now();
      const isFinal = writtenLbas >= totalLbas;
      const percentDelta = percent - lastReportedPercent;
      const elapsedMs = now - lastReportedAt;
      if (isFinal || percentDelta >= 1 || elapsedMs >= 250) {
        onProgress({
          phase: "flashing",
          percent,
          message: `Wrote ${(bytesWritten / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`,
          bytesWritten,
          bytesTotal: totalBytes,
          phasePercent: Math.floor((writtenLbas / totalLbas) * 100),
        });
        lastReportedPercent = percent;
        lastReportedAt = now;
      }
    }

    onProgress({
      phase: "restarting",
      percent: 97,
      message: "Resetting device...",
    });

    await this.resetDevice().catch(() => {
      // RESET_DEVICE is fire-and-forget — the device disappears from
      // the bus before the CSW can complete on some SoCs. Do not raise.
    });

    onProgress({
      phase: "done",
      percent: 100,
      message: "Flash complete. Unplug and re-plug the board to boot the new image.",
    });

    await this.releaseClaimed();
  }

  /**
   * Verification placeholder. A proper verify pass would READ_LBA each
   * region back and compare against the expected SHA-256. That is a
   * follow-up — for the slice we land, the SHA-256 check happens on the
   * download side before flash even starts.
   */
  async verify(): Promise<void> {
    // No-op for now. Keeps the method present on the SbcImageFlasher
    // contract so the calling layer doesn't have to feature-test.
  }

  abort(): void {
    this.aborted = true;
  }

  async dispose(): Promise<void> {
    await this.releaseClaimed();
  }

  // ── USB plumbing ───────────────────────────────────────────

  private async openAndClaim(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (this.device.configuration === null) {
      await this.device.selectConfiguration(1);
    }
    const conf = this.device.configuration;
    if (!conf) throw new Error("Rockchip device has no USB configuration.");

    // Pick the first interface that exposes both bulk-in and bulk-out
    // endpoints. Maskrom-stage devices may have only a control surface;
    // those still need to be opened so we can issue the code-download
    // control transfer, but we won't have valid bulk endpoints until
    // loader stage.
    let chosen: USBInterface | null = null;
    let bulkIn = 0;
    let bulkOut = 0;
    for (const iface of conf.interfaces) {
      for (const alt of iface.alternates) {
        const inEp = alt.endpoints.find(
          (e) => e.direction === "in" && e.type === "bulk",
        );
        const outEp = alt.endpoints.find(
          (e) => e.direction === "out" && e.type === "bulk",
        );
        if (inEp && outEp) {
          chosen = iface;
          bulkIn = inEp.endpointNumber;
          bulkOut = outEp.endpointNumber;
          break;
        }
      }
      if (chosen) break;
    }

    if (!chosen) {
      // Maskrom stage — only the control endpoint matters. Claim the
      // first interface so we can issue the code-download.
      chosen = conf.interfaces[0] ?? null;
      if (!chosen) {
        throw new Error("Rockchip device exposes no USB interfaces.");
      }
    }

    this.interfaceNumber = chosen.interfaceNumber;
    this.epIn = bulkIn;
    this.epOut = bulkOut;

    if (!chosen.claimed) {
      await this.device.claimInterface(this.interfaceNumber);
      this.claimed = true;
    }
  }

  private async releaseClaimed(): Promise<void> {
    try {
      if (this.claimed && this.device.opened) {
        await this.device
          .releaseInterface(this.interfaceNumber)
          .catch(() => {});
        await this.device.close().catch(() => {});
      }
    } catch {
      // Ignore — close failures are normal after a device reset.
    }
    this.claimed = false;
  }

  /**
   * Wait for the device to reappear after maskrom code-download. The
   * SoC may keep the same vendor/product id pair and only swap its
   * interface descriptor, or it may show up under a different pid; we
   * accept any 0x2207 device that has a bulk-in/bulk-out pair.
   */
  private async waitForLoaderStage(
    timeoutMs: number,
    previousDevice: USBDevice | null,
  ): Promise<USBDevice> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.checkAbort();
      await this.delay(150);
      const candidates = await navigator.usb.getDevices();
      for (const d of candidates) {
        if (d.vendorId !== ROCKCHIP_USB_VID) continue;
        // Re-enumeration may keep the same vendor id and swap only the
        // interface descriptor. We skip the *exact same* USBDevice
        // instance only when it is still in maskrom mode (no bulk
        // endpoints); the loader-stage successor is a different
        // instance and is matched on bulk-pair presence below.
        // Need to peek configuration to see if bulk endpoints exist;
        // open lazily.
        try {
          if (!d.opened) await d.open();
          if (d.configuration === null) await d.selectConfiguration(1);
          const conf = d.configuration;
          if (!conf) continue;
          const hasBulk = conf.interfaces.some((iface) =>
            iface.alternates.some(
              (alt) =>
                alt.endpoints.some(
                  (e) => e.direction === "in" && e.type === "bulk",
                ) &&
                alt.endpoints.some(
                  (e) => e.direction === "out" && e.type === "bulk",
                ),
            ),
          );
          if (hasBulk) {
            // If we accidentally rediscovered the maskrom-stage device
            // (same instance, same descriptor), skip and keep polling —
            // the loader replacement may still be appearing on the bus.
            if (d === previousDevice) {
              await d.close().catch(() => {});
              continue;
            }
            return d;
          }
          await d.close().catch(() => {});
        } catch {
          // Try next candidate.
        }
      }
    }
    throw new Error(
      "Rockchip device did not re-enumerate into loader stage in time. Unplug, hold BOOT, and replug.",
    );
  }

  // ── Maskrom-stage transfers ────────────────────────────────

  /**
   * Push a binary loader blob into the SoC SRAM via the maskrom
   * code-download control transfer. The wValue field is the 16-bit
   * starting address; the payload is sliced into 4 KiB control-OUT
   * frames (the maskrom ROM expects per-frame XOR scrambling on some
   * SoCs but the public protocol surface accepts plain bytes for
   * RV-series targets, which is what we ship today).
   */
  private async maskromCodeDownload(blob: Uint8Array): Promise<void> {
    const FRAME = 4096;
    let offset = 0;
    while (offset < blob.byteLength) {
      this.checkAbort();
      const slice = blob.subarray(offset, offset + FRAME);
      await this.withTimeout(
        this.device.controlTransferOut(
          {
            requestType: "vendor",
            recipient: "device",
            request: MASKROM_REQ_DOWNLOAD,
            value: 0,
            index: 0,
          },
          slice,
        ),
        CONTROL_TIMEOUT_MS,
        "Maskrom code-download",
      );
      offset += slice.byteLength;
    }
  }

  /**
   * Tell the maskrom to jump to the freshly downloaded code at the
   * supplied entry address. The SoC will re-enumerate as the loader
   * stage device after this returns.
   */
  private async maskromExecute(entry: number): Promise<void> {
    await this.withTimeout(
      this.device.controlTransferOut({
        requestType: "vendor",
        recipient: "device",
        request: MASKROM_REQ_EXECUTE,
        value: entry & 0xffff,
        index: (entry >> 16) & 0xffff,
      }),
      CONTROL_TIMEOUT_MS,
      "Maskrom execute",
    );
  }

  // ── Loader-stage CBW/CSW framing ───────────────────────────

  /** Build a 31-byte command block wrapper. */
  private buildCbw(args: {
    tag: number;
    transferLength: number;
    direction: "in" | "out" | "none";
    opcode: number;
    cb?: Uint8Array;
  }): Uint8Array {
    if ((args.tag >>> 0) !== args.tag) {
      throw new Error("CBW tag exceeds u32 range.");
    }
    if (args.transferLength < 0 || args.transferLength > 0xffffffff) {
      throw new Error("CBW transferLength exceeds u32 range.");
    }
    if (args.opcode < 0 || args.opcode > 0xff) {
      throw new Error("CBW opcode out of range (must fit in one byte).");
    }
    const cbw = new Uint8Array(CBW_LENGTH);
    // Defensive: Uint8Array() is spec-zeroed but explicit fill guards
    // against future refactors that pool or reuse the underlying buffer.
    cbw.fill(0);
    const view = new DataView(cbw.buffer);
    view.setUint32(0, CBW_SIGNATURE, true);
    view.setUint32(4, args.tag, true);
    view.setUint32(8, args.transferLength, true);
    // Per USB Mass Storage BOT spec, the direction flag is set to OUT
    // (0x00) when there is no data stage; only IN commands set bit 7.
    cbw[12] = args.direction === "in" ? CBW_FLAG_IN : CBW_FLAG_OUT;
    cbw[13] = 0; // bCBWLUN
    // bCBWCBLength: command block size in bytes. We pack opcode + a
    // 15-byte payload, all little-endian.
    cbw[14] = 16;
    cbw[15] = args.opcode;
    if (args.cb && args.cb.byteLength > 0) {
      cbw.set(args.cb.subarray(0, Math.min(args.cb.byteLength, 15)), 16);
    }
    return cbw;
  }

  /** Read and validate the 13-byte command status wrapper. */
  private async readCsw(expectedTag: number): Promise<{
    residue: number;
    status: number;
  }> {
    const result = await this.device.transferIn(this.epIn, CSW_LENGTH);
    if (!result.data || result.data.byteLength < CSW_LENGTH) {
      throw new Error("Short CSW from device.");
    }
    const view = result.data;
    const sig = view.getUint32(0, true);
    if (sig !== CSW_SIGNATURE) {
      throw new Error(`Bad CSW signature: 0x${sig.toString(16)}`);
    }
    const tag = view.getUint32(4, true);
    if (tag !== expectedTag) {
      throw new Error(`CSW tag mismatch: expected ${expectedTag}, got ${tag}`);
    }
    return {
      residue: view.getUint32(8, true),
      status: view.getUint8(12),
    };
  }

  private nextTag(): number {
    // 32-bit pseudo-random tag is fine; the protocol just needs it to
    // round-trip from CBW into the matching CSW.
    return (Math.random() * 0xffffffff) >>> 0;
  }

  /** Issue a CBW + optional data + CSW round trip. */
  private async runCommand(args: {
    opcode: number;
    direction: "in" | "out" | "none";
    transferLength: number;
    cb?: Uint8Array;
    data?: Uint8Array;
  }): Promise<Uint8Array | null> {
    const tag = this.nextTag();
    const cbw = this.buildCbw({
      tag,
      transferLength: args.transferLength,
      direction: args.direction,
      opcode: args.opcode,
      cb: args.cb,
    });

    await this.bulkOut(cbw);

    let payload: Uint8Array | null = null;
    if (args.direction === "in" && args.transferLength > 0) {
      payload = await this.bulkIn(args.transferLength);
    } else if (args.direction === "out" && args.data) {
      await this.bulkOut(args.data);
    }

    const csw = await this.readCsw(tag);
    if (csw.status !== 0) {
      throw new Error(
        `rockusb command 0x${args.opcode.toString(16)} failed (CSW status ${csw.status}, residue ${csw.residue}).`,
      );
    }
    // Non-zero residue on a status-success CSW means the device transferred
    // fewer bytes than the host requested. For READ/WRITE_LBA this is a
    // silent partial-IO that would corrupt the flashed image; reject it
    // here rather than letting the caller treat the command as successful.
    if (csw.residue !== 0) {
      throw new Error(
        `rockusb command 0x${args.opcode.toString(16)} reported ${csw.residue} bytes residue (expected full transfer of ${args.transferLength}).`,
      );
    }
    return payload;
  }

  private async bulkOut(data: Uint8Array): Promise<void> {
    // WebUSB transferOut wants a BufferSource backed by ArrayBuffer.
    // Newer lib.dom revisions narrow Uint8Array to ArrayBufferLike (so
    // SharedArrayBuffer-backed views are excluded); every caller passes a
    // view over a plain ArrayBuffer, so narrow the buffer type.
    const result = await this.runWithRetry(
      "Bulk OUT",
      (timeoutMs) =>
        this.withTimeout(
          this.device.transferOut(this.epOut, data as Uint8Array<ArrayBuffer>),
          timeoutMs,
          "Bulk OUT",
        ),
    );
    if (result.status !== "ok") {
      throw new Error(`Bulk OUT transfer status: ${result.status}`);
    }
  }

  private async bulkIn(length: number): Promise<Uint8Array> {
    const result = await this.runWithRetry(
      "Bulk IN",
      (timeoutMs) =>
        this.withTimeout(
          this.device.transferIn(this.epIn, length),
          timeoutMs,
          "Bulk IN",
        ),
    );
    if (result.status !== "ok" || !result.data) {
      throw new Error(`Bulk IN transfer status: ${result.status}`);
    }
    return new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength,
    );
  }

  /**
   * Drive a bulk transfer with one or two retries on transient timeouts.
   * Timeout schedule: 30s, 5s, 10s (~45s total budget). NetworkError /
   * SecurityError / aborts are terminal and propagate immediately.
   */
  private async runWithRetry<T>(
    label: string,
    op: (timeoutMs: number) => Promise<T>,
  ): Promise<T> {
    const schedule = [BULK_TIMEOUT_MS, 5_000, 10_000];
    let lastErr: unknown;
    for (let attempt = 0; attempt < schedule.length; attempt++) {
      this.checkAbort();
      try {
        return await op(schedule[attempt]);
      } catch (err) {
        lastErr = err;
        if (!this.isTransientUsbTimeout(err)) {
          throw err;
        }
        this.checkAbort();
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`${label} failed after ${schedule.length} attempts.`);
  }

  private isTransientUsbTimeout(err: unknown): boolean {
    if (this.aborted) return false;
    if (err instanceof Error && err.name === "TimeoutError") return true;
    // DOMException flavoured timeouts surface with name "TimeoutError" too.
    if (
      typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "TimeoutError"
    ) {
      return true;
    }
    return false;
  }

  // ── rockusb commands ───────────────────────────────────────

  private async readFlashId(): Promise<RockchipFlashId> {
    const data = await this.runCommand({
      opcode: ROCKUSB_OP.READ_FLASH_ID,
      direction: "in",
      transferLength: 5,
    });
    if (!data) throw new Error("READ_FLASH_ID returned no data.");
    const hex = Array.from(data)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    return { raw: data, hex };
  }

  private async writeLba(
    startLba: number,
    lbaCount: number,
    payload: Uint8Array,
  ): Promise<void> {
    if (this.epOut === 0 || this.epIn === 0) {
      throw new Error(
        "Bulk endpoints not initialized. Call prepare() before flash().",
      );
    }
    if (startLba < 0 || startLba > 0xffffffff) {
      throw new Error("startLba exceeds u32 range.");
    }
    if (lbaCount < 0 || lbaCount > 0xffff) {
      throw new Error("lbaCount exceeds u16 range.");
    }
    const cb = new Uint8Array(15);
    cb.fill(0);
    const cbView = new DataView(cb.buffer);
    // Big-endian sector address per the rockusb command block layout.
    cbView.setUint32(1, startLba >>> 0, false);
    cbView.setUint16(7, lbaCount & 0xffff, false);
    await this.runCommand({
      opcode: ROCKUSB_OP.WRITE_LBA,
      direction: "out",
      transferLength: payload.byteLength,
      cb,
      data: payload,
    });
  }

  /**
   * READ_LBA is provided so a future verify pass can read sectors back
   * for SHA-256 comparison. Not used by the current flash() flow.
   */
  private async readLba(
    startLba: number,
    lbaCount: number,
  ): Promise<Uint8Array> {
    if (startLba < 0 || startLba > 0xffffffff) {
      throw new Error("startLba exceeds u32 range.");
    }
    if (lbaCount < 0 || lbaCount > 0xffff) {
      throw new Error("lbaCount exceeds u16 range.");
    }
    const cb = new Uint8Array(15);
    cb.fill(0);
    const cbView = new DataView(cb.buffer);
    cbView.setUint32(1, startLba >>> 0, false);
    cbView.setUint16(7, lbaCount & 0xffff, false);
    const data = await this.runCommand({
      opcode: ROCKUSB_OP.READ_LBA,
      direction: "in",
      transferLength: lbaCount * LBA_SIZE,
      cb,
    });
    if (!data) throw new Error("READ_LBA returned no data.");
    return data;
  }

  private async resetDevice(): Promise<void> {
    const cb = new Uint8Array(15);
    cb.fill(0);
    cb[0] = 0x00; // subcommand: full reset
    await this.runCommand({
      opcode: ROCKUSB_OP.RESET_DEVICE,
      direction: "none",
      transferLength: 0,
      cb,
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  private checkAbort(): void {
    if (this.aborted) {
      throw new Error("Flash aborted by user.");
    }
  }

  private delay(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timer = undefined;
        resolve();
      }, ms);
    }).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    });
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label = "USB transfer",
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timer = undefined;
        const err = new Error(`${label} timed out after ${ms}ms.`);
        err.name = "TimeoutError";
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    });
  }
}
