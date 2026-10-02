// Exempt from 300 LOC soft rule: self-contained WebUSB rockusb protocol
// client. The CBW/CSW framing, LBA streaming and read-back share private
// device handles and protocol constants that have no caller-facing seam;
// splitting them would expose internal transport state across module
// boundaries with no consumer benefit.
/**
 * Rockchip rockusb in-browser flasher.
 *
 * Talks the Rockchip rockusb loader protocol over WebUSB to write a full
 * system image (.img.gz) to the eMMC of an SBC sitting in loader stage:
 * bulk endpoints expose a SCSI-like command surface (CBW out, data, CSW in).
 * We use READ_FLASH_ID to confirm the loader answers, WRITE_LBA to stream
 * the decompressed image into eMMC, READ_LBA to read it back and compare,
 * then RESET_DEVICE to reboot into the freshly flashed system.
 *
 * A board in maskrom (the SoC ROM, before any loader runs) does not answer
 * rockusb commands, and loading a loader into it needs the SoC-specific
 * DDR-init/usbplug download this client does not implement. prepare()
 * detects that within a few seconds and tells the operator to boot the
 * board into loader mode instead of hanging.
 *
 * Image input is always a gzip-compressed raw disk image (.img.gz). We
 * decompress with pako, slice into 512-byte LBA blocks, and stream the
 * payload into the device. The compressed blob ships with a SHA-256
 * digest and a minisign signature that the calling layer verifies before
 * this flasher ever opens the device.
 *
 * A data stage is never re-sent on its own: a timeout clears both bulk
 * endpoints and restarts the whole CBW / data / CSW command, so the
 * command and status framing cannot drift apart.
 *
 * Writes start at sector 0 of a flat raw image.
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
 * Budget for the loader to answer READ_FLASH_ID. A loader answers in
 * milliseconds; a board in maskrom never does.
 */
const PROBE_TIMEOUT_MS = 3_000;

/** How many times a whole command is run before a timeout is final. */
const COMMAND_ATTEMPTS = 3;

/** Shown when the board does not answer rockusb commands. */
const MASKROM_MESSAGE =
  "The board did not answer as a rockusb loader; it is probably in maskrom mode, which this tool cannot load. " +
  "Boot it into loader mode (hold the recovery key while powering on, or run `reboot loader` on the board), then retry.";

// ── Public API types ─────────────────────────────────────────

/** Options accepted by {@link RockchipBootromFlasher.prepare}. */
export interface RockchipPrepareOptions {
  /** Abort signal honoured while the loader is probed. */
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
  /** Write the image, read it back and compare, then reset the board. */
  flash(
    image: ArrayBuffer | Uint8Array,
    onProgress: FlashProgressCallback,
    signal?: AbortSignal,
  ): Promise<void>;
  abort(): void;
  dispose(): Promise<void>;
}

// ── CBW framing ──────────────────────────────────────────────

/** CBW direction for a rockusb command. */
export type RockusbDirection = "in" | "out" | "none";

/** One rockusb command: CBW fields plus an optional OUT data stage. */
interface RockusbCommand {
  opcode: number;
  direction: RockusbDirection;
  transferLength: number;
  cb?: Uint8Array;
  data?: Uint8Array;
}

/**
 * Build a 31-byte command block wrapper. The opcode is CBWCB[0] (byte 15)
 * and `cb` fills CBWCB[1..15] (bytes 16..30).
 */
export function buildRockusbCbw(args: {
  tag: number;
  transferLength: number;
  direction: RockusbDirection;
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
  const view = new DataView(cbw.buffer);
  view.setUint32(0, CBW_SIGNATURE, true);
  view.setUint32(4, args.tag, true);
  view.setUint32(8, args.transferLength, true);
  // Per USB Mass Storage BOT spec, the direction flag is set to OUT
  // (0x00) when there is no data stage; only IN commands set bit 7.
  cbw[12] = args.direction === "in" ? CBW_FLAG_IN : CBW_FLAG_OUT;
  cbw[13] = 0; // bCBWLUN
  // bCBWCBLength: opcode + 15-byte command block.
  cbw[14] = 16;
  cbw[15] = args.opcode;
  if (args.cb && args.cb.byteLength > 0) {
    cbw.set(args.cb.subarray(0, Math.min(args.cb.byteLength, 15)), 16);
  }
  return cbw;
}

/**
 * READ_LBA / WRITE_LBA command block (CBWCB[1..15]) in rkdeveloptool's
 * packed layout {opcode, reserved, address(BE u32), reserved, length(BE u16), ...}:
 * the address lands at CBWCB[2..5] and the sector count at CBWCB[7..8].
 */
export function lbaCommandBlock(startLba: number, lbaCount: number): Uint8Array {
  const cb = new Uint8Array(15);
  const view = new DataView(cb.buffer);
  view.setUint32(1, startLba >>> 0, false);
  view.setUint16(6, lbaCount & 0xffff, false);
  return cb;
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
   * Open the device and confirm a rockusb loader answers on its bulk
   * endpoints. A board in maskrom is refused with instructions. Safe to
   * call twice (idempotent).
   */
  async prepare(opts: RockchipPrepareOptions = {}): Promise<void> {
    this.aborted = false;
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => this.abort(), { once: true });
      this.checkAbort();
    }
    await this.openAndClaim();
    if (this.epIn === 0 || this.epOut === 0) throw new Error(MASKROM_MESSAGE);

    // Loader stage probe: a successful READ_FLASH_ID confirms the bulk pipe
    // and the CBW/CSW framing are good. A board in maskrom never answers.
    try {
      await this.readFlashId(PROBE_TIMEOUT_MS);
    } catch (err) {
      if (this.isTimeout(err)) throw new Error(MASKROM_MESSAGE);
      throw err;
    }
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
      const percent = 5 + Math.floor((writtenLbas / totalLbas) * 45);
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

    // Read every sector back and compare before the board is reset. The
    // SHA-256 checked before flashing covers the download, not the eMMC.
    lastReportedPercent = 50;
    lastReportedAt = Date.now();
    let verifiedLbas = 0;
    while (verifiedLbas < totalLbas) {
      this.checkAbort();
      const lbaCount = Math.min(WRITE_CHUNK_LBAS, totalLbas - verifiedLbas);
      const byteOffset = verifiedLbas * LBA_SIZE;
      const readBack = await this.readLba(verifiedLbas, lbaCount);
      const expectedLen = Math.min(lbaCount * LBA_SIZE, totalBytes - byteOffset);
      for (let i = 0; i < expectedLen; i++) {
        if (readBack[i] !== raw[byteOffset + i]) {
          throw new Error(`Verification failed at byte ${byteOffset + i} (sector ${verifiedLbas + Math.floor(i / LBA_SIZE)}). The eMMC holds a corrupt image; flash again.`);
        }
      }
      verifiedLbas += lbaCount;
      const bytesVerified = Math.min(verifiedLbas * LBA_SIZE, totalBytes);
      const percent = 50 + Math.floor((verifiedLbas / totalLbas) * 45);
      const now = Date.now();
      if (verifiedLbas >= totalLbas || percent - lastReportedPercent >= 1 || now - lastReportedAt >= 250) {
        onProgress({
          phase: "verifying",
          percent,
          message: `Verified ${(bytesVerified / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`,
          bytesWritten: bytesVerified,
          bytesTotal: totalBytes,
          phasePercent: Math.floor((verifiedLbas / totalLbas) * 100),
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
      message: "Flash verified. Unplug and re-plug the board to boot the new image.",
    });

    await this.releaseClaimed();
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
    // endpoints. A board in maskrom may expose only a control surface; it
    // is opened anyway so prepare() can refuse it with instructions.
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
      // No bulk pair: claim the first interface; prepare() refuses it.
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

  /** Read and validate the 13-byte command status wrapper. */
  private async readCsw(expectedTag: number, timeoutMs: number): Promise<{
    residue: number;
    status: number;
  }> {
    const result = await this.withTimeout(
      this.device.transferIn(this.epIn, CSW_LENGTH),
      timeoutMs,
      "CSW",
    );
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

  /**
   * Issue a CBW + optional data + CSW round trip. A timeout anywhere in the
   * round trip clears both bulk endpoints and restarts the whole command
   * with a fresh tag (up to `attempts` runs); a data stage is never re-sent
   * on its own. Every rockusb command used here is idempotent.
   */
  private async runCommand(
    args: RockusbCommand,
    timeoutMs: number = BULK_TIMEOUT_MS,
    attempts: number = COMMAND_ATTEMPTS,
  ): Promise<Uint8Array | null> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      this.checkAbort();
      try {
        return await this.runCommandOnce(args, timeoutMs);
      } catch (err) {
        if (!this.isTimeout(err)) throw err;
        lastErr = err;
        await this.device.clearHalt("out", this.epOut).catch(() => {});
        await this.device.clearHalt("in", this.epIn).catch(() => {});
      }
    }
    throw lastErr;
  }

  private async runCommandOnce(args: RockusbCommand, timeoutMs: number): Promise<Uint8Array | null> {
    const tag = this.nextTag();
    const cbw = buildRockusbCbw({
      tag,
      transferLength: args.transferLength,
      direction: args.direction,
      opcode: args.opcode,
      cb: args.cb,
    });

    await this.bulkOut(cbw, timeoutMs);

    let payload: Uint8Array | null = null;
    if (args.direction === "in" && args.transferLength > 0) {
      payload = await this.bulkIn(args.transferLength, timeoutMs);
    } else if (args.direction === "out" && args.data) {
      await this.bulkOut(args.data, timeoutMs);
    }

    const csw = await this.readCsw(tag, timeoutMs);
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
    if (payload && payload.byteLength !== args.transferLength) {
      throw new Error(
        `rockusb command 0x${args.opcode.toString(16)} returned ${payload.byteLength} of ${args.transferLength} bytes.`,
      );
    }
    return payload;
  }

  /**
   * One bulk transfer with a deadline and no retry: a data stage must never
   * be sent twice inside one command.
   */
  private async bulkOut(data: Uint8Array, timeoutMs: number): Promise<void> {
    // WebUSB transferOut wants a BufferSource backed by ArrayBuffer.
    // Newer lib.dom revisions narrow Uint8Array to ArrayBufferLike (so
    // SharedArrayBuffer-backed views are excluded); every caller passes a
    // view over a plain ArrayBuffer, so narrow the buffer type.
    const result = await this.withTimeout(
      this.device.transferOut(this.epOut, data as Uint8Array<ArrayBuffer>),
      timeoutMs,
      "Bulk OUT",
    );
    if (result.status !== "ok") {
      throw new Error(`Bulk OUT transfer status: ${result.status}`);
    }
  }

  private async bulkIn(length: number, timeoutMs: number): Promise<Uint8Array> {
    const result = await this.withTimeout(
      this.device.transferIn(this.epIn, length),
      timeoutMs,
      "Bulk IN",
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

  private isTimeout(err: unknown): boolean {
    if (this.aborted) return false;
    // Error and DOMException timeouts both carry the name "TimeoutError".
    return (err instanceof Error || (typeof DOMException !== "undefined" && err instanceof DOMException))
      && err.name === "TimeoutError";
  }

  // ── rockusb commands ───────────────────────────────────────

  /** READ_FLASH_ID as a single short probe: a loader answers at once, a maskrom board never. */
  private async readFlashId(probeTimeoutMs: number): Promise<RockchipFlashId> {
    const data = await this.runCommand(
      { opcode: ROCKUSB_OP.READ_FLASH_ID, direction: "in", transferLength: 5 },
      probeTimeoutMs,
      1,
    );
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
    await this.runCommand({
      opcode: ROCKUSB_OP.WRITE_LBA,
      direction: "out",
      transferLength: payload.byteLength,
      cb: lbaCommandBlock(startLba, lbaCount),
      data: payload,
    });
  }

  /** READ_LBA, used by flash() to read the written image back. */
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
    const data = await this.runCommand({
      opcode: ROCKUSB_OP.READ_LBA,
      direction: "in",
      transferLength: lbaCount * LBA_SIZE,
      cb: lbaCommandBlock(startLba, lbaCount),
    });
    if (!data) throw new Error("READ_LBA returned no data.");
    return data;
  }

  private async resetDevice(): Promise<void> {
    const cb = new Uint8Array(15);
    cb.fill(0);
    cb[0] = 0x00; // subcommand: full reset
    // The board drops off the bus as it resets, so one short attempt.
    await this.runCommand(
      { opcode: ROCKUSB_OP.RESET_DEVICE, direction: "none", transferLength: 0, cb },
      5_000,
      1,
    );
  }

  // ── Helpers ────────────────────────────────────────────────

  private checkAbort(): void {
    if (this.aborted) {
      throw new Error("Flash aborted by user.");
    }
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
