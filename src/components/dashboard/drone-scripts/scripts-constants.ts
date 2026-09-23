/**
 * @module drone-scripts/scripts-constants
 * @description Shared constants for the ArduPilot Lua Scripts tab: the FC
 * scripts directory, the SCR_* parameter set, and the enum/bitmask option maps
 * that drive the config card. ArduPilot runs onboard Lua from `APM/scripts/`
 * on the SD card; the SCR_* params enable the VM and bound its resources.
 * @license GPL-3.0-only
 */

/** The FC-side directory ArduPilot scans for `.lua` scripts at boot. */
export const SCRIPTS_DIR = "APM/scripts";

/** Core SCR_* params the config card always reads. */
export const SCR_PARAM_NAMES = [
  "SCR_ENABLE",
  "SCR_HEAP_SIZE",
  "SCR_VM_I_COUNT",
  "SCR_DEBUG_OPTS",
] as const;

/** SCR_* params present only on some builds — read best-effort. */
export const SCR_OPTIONAL_PARAM_NAMES = [
  "SCR_DIR_DISABLE",
  "SCR_LD_CHECKSUM",
  "SCR_RUN_CHECKSUM",
  "SCR_THD_PRIORITY",
] as const;

/** SCR_ENABLE: whether the onboard Lua VM runs. Changing it needs a reboot. */
export const SCR_ENABLE_VALUES = new Map<number, string>([
  [0, "Disabled"],
  [1, "Lua scripts"],
]);

/** SCR_DEBUG_OPTS bit index → label, matching the firmware's bitmask
 * definition. Controls scripting log/diagnostic output and a few safety
 * toggles. Bits are preserved if undocumented (BitmaskEditor). */
export const SCR_DEBUG_OPTS_BITS = new Map<number, string>([
  [0, 'Send "No scripts to run" message'],
  [1, "Runtime memory/time messages"],
  [2, "Do not log script contents to dataflash"],
  [3, "Log runtime memory + execution time"],
  [4, "Disable pre-arm check"],
  [5, "Save CRC of current scripts to SCR_LD/RUN_CHECKSUM"],
  [6, "Disable heap expansion on out-of-memory"],
]);

/** SCR_DIR_DISABLE bit index → label (which script directories are skipped). */
export const SCR_DIR_DISABLE_BITS = new Map<number, string>([
  [0, "Skip ROMFS scripts"],
  [1, "Skip APM/scripts (SD card)"],
]);

/** Allowed upload extension. ArduPilot only executes `.lua`. */
export const SCRIPT_EXTENSION = ".lua";

/** Reject oversized uploads early — onboard heap is small; a multi-hundred-KB
 * script almost always means the wrong file was picked. */
export const MAX_SCRIPT_BYTES = 512 * 1024;
