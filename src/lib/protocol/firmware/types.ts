/**
 * Firmware flashing types for Altnautica Command GCS.
 *
 * Covers STM32 serial bootloader, USB DFU, ArduPilot manifest,
 * and the orchestration layer. No imports from other modules.
 *
 * @module protocol/firmware/types
 */

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

/** Progress update emitted during flashing. */
export interface FlashProgress {
  phase: FlashPhase;
  /** Overall progress 0-100. */
  percent: number;
  message: string;
  bytesWritten?: number;
  bytesTotal?: number;
  /** Progress within the current phase 0-100. */
  phasePercent?: number;
}

/** Callback for flash progress updates. */
export type FlashProgressCallback = (progress: FlashProgress) => void;

/** Flash method selection. */
export type FlashMethod = "serial" | "dfu" | "auto" | "px4-serial";

/** Firmware stack selection for the Flash Tool UI. */
export type FirmwareStack = "ardupilot" | "betaflight" | "px4";

// ── Chip / STM32 ───────────────────────────────────────────

/** Identified STM32 chip from bootloader. */
export interface ChipInfo {
  /** 16-bit chip signature (e.g. 0x0450 for STM32H743). */
  signature: number;
  /** Human-readable chip name. */
  name: string;
  /** Total flash size in bytes. */
  flashSize: number;
  /** Page/sector size in bytes (for erase granularity). */
  pageSize: number;
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

/** Common interface for serial and DFU flashers. */
export interface FirmwareFlasher {
  readonly method: FlashMethod;
  flash(firmware: ParsedFirmware, onProgress: FlashProgressCallback, signal?: AbortSignal): Promise<void>;
  verify(firmware: ParsedFirmware, onProgress: FlashProgressCallback, signal?: AbortSignal): Promise<void>;
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

/** Parsed firmware image ready for flashing. */
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
}

// ── ArduPilot Manifest ─────────────────────────────────────

/** A board entry derived from the ArduPilot firmware manifest. */
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
  /** Whether to backup parameters before flashing. */
  backupParams: boolean;
  /** Whether to verify after flashing. */
  verify: boolean;
  /** Baud rate for serial bootloader (default 115200). */
  bootloaderBaud?: number;
}
