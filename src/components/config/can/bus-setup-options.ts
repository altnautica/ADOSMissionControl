/** Value lists for the CAN bus setup selects (ArduPilot CAN_* parameters). */

export const DRIVER_OPTIONS = [
  { value: "0", label: "0 — Disabled" },
  { value: "1", label: "1 — First driver" },
  { value: "2", label: "2 — Second driver" },
  { value: "3", label: "3 — Third driver" },
];

export const FD_BITRATE_OPTIONS = [
  { value: "1", label: "1 — 1 Mbit/s" },
  { value: "2", label: "2 — 2 Mbit/s" },
  { value: "4", label: "4 — 4 Mbit/s" },
  { value: "5", label: "5 — 5 Mbit/s" },
  { value: "8", label: "8 — 8 Mbit/s" },
];

export const PROTOCOL_OPTIONS = [
  { value: "0", label: "0 — Disabled" },
  { value: "1", label: "1 — DroneCAN" },
  { value: "4", label: "4 — PiccoloCAN" },
  { value: "5", label: "5 — CAN Tester" },
  { value: "6", label: "6 — EFI NWPMU" },
  { value: "7", label: "7 — USD1" },
  { value: "8", label: "8 — KDECAN" },
  { value: "10", label: "10 — Scripting" },
  { value: "11", label: "11 — Benewake" },
  { value: "12", label: "12 — Scripting 2" },
];

export const SLCAN_CPORT_OPTIONS = [
  { value: "0", label: "0 — Disabled" },
  { value: "1", label: "1 — CAN1" },
  { value: "2", label: "2 — CAN2" },
];

export const SLCAN_SERIAL_OPTIONS = [
  { value: "-1", label: "-1 — Disabled" },
  { value: "0", label: "0 — Serial0 (USB)" },
  { value: "1", label: "1 — Serial1" },
  { value: "2", label: "2 — Serial2" },
  { value: "3", label: "3 — Serial3" },
  { value: "4", label: "4 — Serial4" },
  { value: "5", label: "5 — Serial5" },
  { value: "6", label: "6 — Serial6" },
];

export const BITRATE_QUICK_PICKS = [1_000_000, 500_000, 250_000, 125_000];
