/**
 * Firmware panel constants — vehicle types, firmware stacks, flash methods,
 * pre-flash safety checklist items per stack.
 */

import type { FlashMethod, FirmwareStack } from "@/lib/protocol/firmware/types";
import type { ChecklistItem } from "./FirmwareCommonSections";
import { Wifi, Usb, Radio } from "lucide-react";

export const VEHICLE_TYPES = [
  { value: "Copter", label: "ArduCopter (Multirotor)" },
  { value: "Plane", label: "ArduPlane (Fixed Wing)" },
  { value: "Rover", label: "ArduRover (Ground Vehicle)" },
  { value: "Sub", label: "ArduSub (Submarine)" },
];

export const FIRMWARE_STACKS: { id: FirmwareStack; label: string; labelKey?: string }[] = [
  { id: "ardupilot", label: "ArduPilot" },
  { id: "betaflight", label: "Betaflight" },
  { id: "px4", label: "PX4" },
  { id: "ap-periph", label: "AP_Periph (CAN nodes)", labelKey: "apPeriph" },
  { id: "ados-drone-agent", label: "ADOS Drone Agent", labelKey: "stack.drone" },
  { id: "ados-ground-agent", label: "ADOS Ground Agent", labelKey: "stack.ground" },
];

/** Stacks that target a flight controller chip rather than a companion SBC. */
export const FC_STACKS: ReadonlySet<FirmwareStack> = new Set([
  "ardupilot",
  "betaflight",
  "px4",
]);

/** Stacks that target an ADOS companion-computer SBC. */
export const ADOS_STACKS: ReadonlySet<FirmwareStack> = new Set([
  "ados-drone-agent",
  "ados-ground-agent",
]);

/** Stacks that target a CAN-bus peripheral node (flashed over DroneCAN OTA). */
export const PERIPHERAL_STACKS: ReadonlySet<FirmwareStack> = new Set([
  "ap-periph",
]);

export function isAdosStack(stack: FirmwareStack): boolean {
  return ADOS_STACKS.has(stack);
}

export function isFcStack(stack: FirmwareStack): boolean {
  return FC_STACKS.has(stack);
}

export function isPeripheralStack(stack: FirmwareStack): boolean {
  return PERIPHERAL_STACKS.has(stack);
}

export const AP_FLASH_METHODS: { id: FlashMethod; label: string; icon: typeof Wifi; desc: string }[] = [
  { id: "auto", label: "Auto", icon: Radio, desc: "ArduPilot bootloader over USB; USB DFU when a DFU device is present" },
  { id: "px4-serial", label: "Bootloader (USB)", icon: Wifi, desc: "ArduPilot bootloader over USB (.apj)" },
  { id: "dfu", label: "USB DFU", icon: Usb, desc: "STM32 USB DFU with the _with_bl.hex image" },
  { id: "st-rom-serial", label: "ST ROM (UART)", icon: Wifi, desc: "ST ROM bootloader (UART, BOOT0)" },
];

export const BF_FLASH_METHODS: { id: FlashMethod; label: string; icon: typeof Wifi; desc: string }[] = [
  { id: "auto", label: "Auto", icon: Radio, desc: "USB DFU, then the ST ROM bootloader on the same port" },
  { id: "dfu", label: "USB DFU", icon: Usb, desc: "Native USB DFU" },
  { id: "st-rom-serial", label: "ST ROM (UART)", icon: Wifi, desc: "ST ROM bootloader (UART, BOOT0)" },
];

export const PX4_FLASH_METHODS: { id: FlashMethod; label: string; icon: typeof Wifi; desc: string }[] = [
  { id: "auto", label: "Auto", icon: Radio, desc: "PX4 bootloader over USB" },
  { id: "px4-serial", label: "PX4 Bootloader", icon: Wifi, desc: "PX4 bootloader (px_uploader)" },
  { id: "dfu", label: "USB DFU", icon: Usb, desc: "Native USB DFU (absolute .hex images only)" },
];

// ── Pre-flash checklists per stack ─────────────────────────

export const FC_CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  { key: "paramBackup", label: "I have backed up my parameters" },
  { key: "propsRemoved", label: "All propellers are removed" },
  { key: "batteryOff", label: "Flight battery is disconnected (USB power only)" },
];

export const ADOS_CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  { key: "adosDataLoss", label: "Data on the board's storage will be erased", labelKey: "checklist.dataLoss" },
  { key: "adosUsbPower", label: "Board is powered via USB only (no external supply)", labelKey: "checklist.usbPower" },
  { key: "adosBackup", label: "I have backed up any user data on the board", labelKey: "checklist.backup" },
];

export const AP_PERIPH_CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  { key: "apPeriphProps", label: "Props removed from any prop-driving nodes" },
  { key: "apPeriphDisarmed", label: "Drone disarmed" },
  { key: "apPeriphRebootUnderstood", label: "I understand the node will reboot mid-flash" },
];

export const CHECKLIST_ITEMS_BY_STACK: Record<FirmwareStack, readonly ChecklistItem[]> = {
  ardupilot: FC_CHECKLIST_ITEMS,
  betaflight: FC_CHECKLIST_ITEMS,
  px4: FC_CHECKLIST_ITEMS,
  "ap-periph": AP_PERIPH_CHECKLIST_ITEMS,
  "ados-drone-agent": ADOS_CHECKLIST_ITEMS,
  "ados-ground-agent": ADOS_CHECKLIST_ITEMS,
};

export function versionLabel(v: string): string {
  const lower = v.toLowerCase();
  if (lower.startsWith("stable") || lower === "official") return `Stable ${v.replace(/^stable-/i, "")} (Recommended)`;
  if (lower === "beta") return "Latest Beta";
  if (lower === "latest") return "Latest Build";
  if (lower === "dev") return "Development (Unstable)";
  return v;
}
