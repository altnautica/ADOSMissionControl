/**
 * Firmware flashing types for Altnautica Command GCS.
 *
 * Covers STM32 serial bootloader, USB DFU, ArduPilot manifest,
 * and the orchestration layer. No imports from other modules.
 *
 * @module protocol/firmware/types
 */

import type { BootloaderId } from "@/lib/serial-bootloader-ids";

// ── Flash State Machine ────────────────────────────────────

/** Phase of the flash workflow. */
export type FlashPhase =
  | "idle"
  | "backup"
  | "rebooting"
  | "bootloader_wait"
  | "bootloader_init"
  | "chip_detect"
  | "erasing"
  | "flashing"
  | "verifying"
  | "restarting"
  | "restoring"
  | "done"
  | "error";

/**
 * A user action the flow is blocked on. Set when automatic device recovery
 * cannot proceed without a fresh user gesture (the browser requires a click
 * to open a re-enumerated device picker).
 */
export interface FlashUserAction {
  kind: "select-bootloader" | "select-dfu" | "select-rockchip";
  /** Bootloader VID/PID filters for the device picker (serial path). */
  filters?: BootloaderId[];
}

/** Progress update emitted during flashing. */
export interface FlashProgress {
  phase: FlashPhase;
  /** Overall progress 0-100. */
  percent: number;
  message: string;
  bytesWritten?: number;
  bytesTotal?: number;
  /** Progress within the current FlashPhase, 0 to 100. */
  phasePercent?: number;
  /** When set, the UI must render a button whose click satisfies the action. */
  action?: FlashUserAction;
}

/** Callback for flash progress updates. */
export type FlashProgressCallback = (progress: FlashProgress) => void;

/**
 * Optional fine-grained log channel for protocol-level tracing (port VID/PID,
 * sync attempts, raw TX/RX bytes). Additive and optional — flashers that do
 * not emit it still satisfy the {@link FirmwareFlasher} contract.
 */
export type FlashLogCallback = (
  level: "debug" | "info" | "warning" | "error",
  message: string,
  rawHex?: string,
) => void;

/**
 * Flash method selection.
 *
 * - `px4-serial`: PX4-protocol bootloader over USB serial (PX4 and ArduPilot
 *   bootloaders). Takes .px4 / .apj application images.
 * - `dfu`: STM32 USB DFU. Needs an absolute image (`_with_bl.hex`, .hex).
 * - `st-rom-serial`: STM32 ROM bootloader over a UART (AN3155, BOOT0 or a
 *   software jump into system memory). Needs an absolute image.
 * - `auto`: pick from the image kind and the devices present.
 */
export type FlashMethod = "st-rom-serial" | "dfu" | "auto" | "px4-serial" | "dronecan-ota";

/**
 * Refusal when a bootloader application image (.apj / .px4) reaches a path
 * that writes absolute addresses (USB DFU, ST ROM bootloader).
 */
export const WITH_BL_REQUIRED_MESSAGE = "This board needs the _with_bl.hex image for USB DFU flashing";

/** Firmware stack selection for the Flash Tool UI. */
export type FirmwareStack =
  | "ardupilot"
  | "betaflight"
  | "px4"
  | "ap-periph"
  | "ados-drone-agent"
  | "ados-ground-agent";

// ── Chip / STM32 ───────────────────────────────────────────

/** A run of `count` equal-size erase sectors, in flash order. */
export interface ChipSectorRun {
  count: number;
  /** Sector size in bytes. */
  size: number;
}

/** Identified STM32 chip from bootloader. */
export interface ChipInfo {
  /** 16-bit chip signature (e.g. 0x0450 for STM32H743). */
  signature: number;
  /** Human-readable chip name. */
  name: string;
  /** Total flash size in bytes. */
  flashSize: number;
  /** Erase-sector map from flash base; erase commands take indices into it. */
  sectors: ChipSectorRun[];
  /** Flash base address (typically 0x08000000). */
  flashBase: number;
  /** Whether this chip uses extended erase (0x44) vs basic erase (0x43). */
  useExtendedErase: boolean;
}

// ── DFU ────────────────────────────────────────────────────

/** A sector in the DFuSe flash layout. */
export interface DfuSector {
  /** Start address of this sector. */
  address: number;
  /** Size of this sector in bytes. */
  size: number;
  /** Number of identical sectors at this size. */
  count: number;
  /** 'a' = readable, 'b' = erasable, 'c' = readable+erasable, 'g' = writable+erasable. */
  properties: string;
}

/** DFuSe flash memory layout parsed from USB descriptors. */
export interface DfuFlashLayout {
  /** Name from alternate setting string (e.g. "Internal Flash"). */
  name: string;
  /** Base address of this memory region. */
  baseAddress: number;
  /** Sectors in this region. */
  sectors: DfuSector[];
  /** Total size of this memory region. */
  totalSize: number;
}

/** USB DFU device states per DFU 1.1 spec. */
export type DfuState =
  | "appIDLE"
  | "appDETACH"
  | "dfuIDLE"
  | "dfuDNLOAD_SYNC"
  | "dfuDNBUSY"
  | "dfuDNLOAD_IDLE"
  | "dfuMANIFEST_SYNC"
  | "dfuMANIFEST"
  | "dfuMANIFEST_WAIT_RESET"
  | "dfuUPLOAD_IDLE"
  | "dfuERROR";

/** Numeric DFU state values. */
export const DFU_STATE: Record<DfuState, number> = {
  appIDLE: 0,
  appDETACH: 1,
  dfuIDLE: 2,
  dfuDNLOAD_SYNC: 3,
  dfuDNBUSY: 4,
  dfuDNLOAD_IDLE: 5,
  dfuMANIFEST_SYNC: 6,
  dfuMANIFEST: 7,
  dfuMANIFEST_WAIT_RESET: 8,
  dfuUPLOAD_IDLE: 9,
  dfuERROR: 10,
} as const;

/** Reverse lookup from state number to name. */
export const DFU_STATE_NAME: Record<number, DfuState> = Object.fromEntries(
  Object.entries(DFU_STATE).map(([k, v]) => [v, k as DfuState])
) as Record<number, DfuState>;

// ── Firmware Flasher Interface ─────────────────────────────

/** Options controlling a single flash run. */
export interface FlashRunOptions {
  /**
   * Read the written firmware back and compare it BEFORE leaving the
   * bootloader. Defaults to true. Verification must happen while the device is
   * still in the bootloader — once the board leaves it (DFU manifest / GO /
   * reboot) the bootloader is gone and a read-back is impossible.
   */
  verify?: boolean;
}

/** Common interface for serial and DFU flashers. */
export interface FirmwareFlasher {
  readonly method: FlashMethod;
  /**
   * Erase, write, verify (in-bootloader read-back when `options.verify`), then
   * leave the bootloader / reboot into the new firmware as the final step.
   */
  flash(
    firmware: ParsedFirmware,
    onProgress: FlashProgressCallback,
    signal?: AbortSignal,
    onLog?: FlashLogCallback,
    options?: FlashRunOptions,
  ): Promise<void>;
  abort(): void;
  dispose(): Promise<void>;
}

// ── Firmware Parsing ───────────────────────────────────────

/** A contiguous block of firmware data at a specific address. */
export interface FirmwareBlock {
  /** Start address in flash memory. */
  address: number;
  /** Raw firmware bytes. */
  data: Uint8Array;
}

/**
 * Parsed firmware image ready for flashing.
 *
 * An image is either an absolute image (Intel HEX, raw .bin) whose block
 * addresses are real flash addresses, or a bootloader application image
 * (`bootloaderApp`, from .apj / .px4) whose single block starts at offset 0
 * of the application area. An application image is only ever written through
 * the PX4-protocol bootloader, which places it at its own app offset; it must
 * never be written at absolute addresses through DFU or the ST ROM bootloader,
 * because flash base is where the bootloader itself lives.
 */
export interface ParsedFirmware {
  /** One or more contiguous blocks. */
  blocks: FirmwareBlock[];
  /** Total firmware size in bytes. */
  totalBytes: number;
  /** Board ID from APJ metadata (if available). */
  boardId?: number;
  /** Board revision from APJ metadata (if available). */
  boardRevision?: number;
  /** Description string from firmware file. */
  description?: string;
  /** True for a PX4/ArduPilot bootloader application image (app-relative offsets). */
  bootloaderApp?: boolean;
}

// ── ArduPilot Manifest ─────────────────────────────────────

/** A board entry parsed from the firmware manifest JSON. */
export interface ManifestBoard {
  /** Board name as it appears in the manifest (e.g. "MatekH743"). */
  name: string;
  /** Available vehicle types for this board. */
  vehicleTypes: string[];
}

/** A single firmware entry from the ArduPilot manifest. */
export interface ManifestFirmware {
  /** Board name. */
  board: string;
  /** Vehicle type (e.g. "Copter", "Plane", "Rover", "Sub"). */
  vehicleType: string;
  /** Version string (e.g. "4.5.7", "latest"). */
  version: string;
  /** Release type: "OFFICIAL", "beta", "dev", "latest". */
  releaseType: string;
  /** Download URL for the firmware file. */
  url: string;
  /** File format (e.g. "apj", "hex", "bin", "px4"). */
  format: string;
  /** Git hash of the build. */
  gitHash?: string;
  /** Build timestamp. */
  buildDate?: string;
  /** APJ_BOARD_ID of the build, when the manifest lists it. */
  boardId?: number;
}

/** The full ArduPilot firmware manifest. */
export interface FirmwareManifest {
  /** All firmware entries. */
  firmwares: ManifestFirmware[];
  /** Manifest format version. */
  formatVersion?: number;
}

// ── Betaflight Types ───────────────────────────────────────

/** A target board from the Betaflight Cloud Build API. */
export interface BetaflightTarget {
  target: string;
  manufacturer: string;
  mcu: string;
  group: string;
}

/** A release version available for a Betaflight target. */
export interface BetaflightRelease {
  release: string;
  label?: string;
}

/** Build info for a specific target + release. */
export interface BetaflightBuildInfo {
  file: string;
  url: string;
  key?: string;
}

/** Request body for a Betaflight Cloud Build. */
export interface BetaflightBuildRequest {
  target: string;
  release: string;
  options: string[];
}

/** Status of a Betaflight Cloud Build job. */
export interface BetaflightBuildStatus {
  key: string;
  status: "queued" | "processing" | "success" | "error";
  progress?: number;
  timeOut?: number;
  configuration?: Record<string, unknown>;
  file?: string;
  url?: string;
}

/** Available build options for a Betaflight release. */
export interface BetaflightBuildOptions {
  radioProtocols: string[];
  telemetryProtocols: string[];
  motorProtocols: string[];
  osdOptions: string[];
  otherOptions: string[];
}

// ── PX4 Types ──────────────────────────────────────────────

/** A PX4 firmware release from GitHub. */
export interface PX4Release {
  tag: string;
  name: string;
  prerelease: boolean;
  boards: PX4Board[];
}

/** A board firmware asset within a PX4 release. */
export interface PX4Board {
  name: string;
  displayName: string;
  assetUrl: string;
  size: number;
}

// ── Flash Options ──────────────────────────────────────────

/** Options for the flash workflow. */
export interface FlashOptions {
  /** Flash method to use. */
  method: FlashMethod;
  /**
   * Back up parameters before rebooting (IndexedDB + .param download). A
   * failed or empty backup aborts the flash.
   */
  backupParams: boolean;
  /** Board label for the backup key `fw-param-backup:<board>:<ISO time>`; defaults to the image board id. */
  backupBoard?: string;
  /** Selected Betaflight/iNav target, checked against the board name the FC reports. */
  expectedBoardTarget?: string;
  /** Whether to verify after flashing. */
  verify: boolean;
  /** Baud rate for serial bootloader (default 115200). */
  bootloaderBaud?: number;
  /** Allow flashing an image whose board id differs from the target (warns). */
  allowBoardIdMismatch?: boolean;
}
