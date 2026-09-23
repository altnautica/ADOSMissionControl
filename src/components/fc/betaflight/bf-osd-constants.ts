// ── Betaflight OSD editor constants and position encoding ──

// ── Types ───────────────────────────────────────────────────

export interface BfOsdElement {
  /** Firmware `osd_items_e` value; the MSP_SET_OSD_CONFIG address. */
  id: number;
  name: string;
  shortLabel: string;
  x: number;
  y: number;
  /** Per-OSD-profile visibility, bit 0 = profile 1 (position bits 11-13). */
  profiles: number;
  /** Element variant (position bits 14-15), preserved on write. */
  variant: number;
}

/** Betaflight `videoSystem_e`: 0 AUTO, 1 PAL, 2 NTSC, 3 HD. */
export type VideoSystem = "AUTO" | "PAL" | "NTSC" | "HD";

export const VIDEO_SYSTEM_CODES: Record<VideoSystem, number> = { AUTO: 0, PAL: 1, NTSC: 2, HD: 3 };

export function videoSystemFromCode(code: number): VideoSystem {
  return (Object.keys(VIDEO_SYSTEM_CODES) as VideoSystem[]).find((vs) => VIDEO_SYSTEM_CODES[vs] === code) ?? "AUTO";
}

// ── Constants ───────────────────────────────────────────────

/** Canvas size: SD MAX7456 is 30 columns; the HD default canvas is 53x20. */
export const VIDEO_COLS: Record<VideoSystem, number> = { AUTO: 30, PAL: 30, NTSC: 30, HD: 53 };
export const VIDEO_ROWS: Record<VideoSystem, number> = { AUTO: 16, PAL: 16, NTSC: 13, HD: 20 };

export const CELL_WIDTH = 20;
export const CELL_HEIGHT = 24;

/** OSD profiles the position word can address (bits 11-13). */
export const OSD_PROFILE_COUNT = 3;

/**
 * Betaflight OSD elements in `osd_items_e` order (osd/osd.h). The enum is
 * append-only, so the array index is the element id on every firmware
 * version; the FC's reported OSD_ITEM_COUNT decides how many exist.
 * Tuple: name, grid label, default column, default row.
 */
const OSD_ITEMS: ReadonlyArray<readonly [string, string, number, number]> = [
  ["RSSI", "RSSI", 1, 1],
  ["Main Battery Voltage", "BATT", 12, 1],
  ["Crosshairs", "+", 14, 8],
  ["Artificial Horizon", "AH", 14, 2],
  ["Horizon Sidebars", "AH|", 14, 6],
  ["Timer 1", "TIM1", 22, 1],
  ["Timer 2", "TIM2", 1, 11],
  ["Fly Mode", "MODE", 13, 11],
  ["Craft Name", "NAME", 10, 12],
  ["Throttle Position", "THR", 1, 7],
  ["VTX Channel", "VTX", 24, 11],
  ["Current Draw", "CURR", 1, 12],
  ["mAh Drawn", "mAh", 1, 13],
  ["GPS Speed", "SPD", 26, 6],
  ["GPS Sats", "SAT", 19, 1],
  ["Altitude", "ALT", 23, 7],
  ["Roll PIDs", "P.R", 7, 13],
  ["Pitch PIDs", "P.P", 7, 14],
  ["Yaw PIDs", "P.Y", 7, 15],
  ["Power", "PWR", 1, 10],
  ["PID / Rate Profile", "PRF", 25, 10],
  ["Warnings", "WARN", 9, 10],
  ["Average Cell Voltage", "CELL", 12, 2],
  ["GPS Longitude", "LON", 18, 14],
  ["GPS Latitude", "LAT", 18, 13],
  ["Debug", "DBG", 1, 0],
  ["Pitch Angle", "PTCH", 1, 8],
  ["Roll Angle", "ROLL", 1, 9],
  ["Main Battery Usage", "B.U", 8, 12],
  ["Disarmed", "DSRM", 10, 4],
  ["Home Direction", "H.D", 14, 9],
  ["Home Distance", "DIST", 25, 9],
  ["Numerical Heading", "HDG", 23, 1],
  ["Numerical Vario", "VARI", 23, 8],
  ["Compass Bar", "CMP", 10, 0],
  ["ESC Temperature", "ETMP", 18, 2],
  ["ESC RPM", "ERPM", 19, 2],
  ["Remaining Time Estimate", "REM", 1, 5],
  ["RTC Date/Time", "RTC", 1, 6],
  ["Adjustment Range", "ADJ", 1, 14],
  ["Core Temperature", "CTMP", 1, 3],
  ["Anti Gravity", "AG", 1, 4],
  ["G-Force", "G", 1, 2],
  ["Motor Diagnostics", "MDIA", 1, 15],
  ["Log Status", "LOG", 20, 3],
  ["Flip Arrow", "FLIP", 14, 5],
  ["Link Quality", "LQ", 1, 2],
  ["Flight Distance", "FDST", 25, 8],
  ["Stick Overlay Left", "S.L", 4, 5],
  ["Stick Overlay Right", "S.R", 23, 5],
  ["Pilot Name", "PNAM", 13, 3],
  ["ESC RPM Frequency", "EHZ", 19, 3],
  ["Rate Profile Name", "RNAM", 15, 2],
  ["PID Profile Name", "PIDN", 2, 2],
  ["OSD Profile Name", "OSDN", 1, 3],
  ["RSSI dBm", "dBm", 1, 4],
  ["RC Channels", "RCCH", 1, 14],
  ["Camera Frame", "CAM", 3, 4],
  ["Efficiency", "EFF", 18, 10],
  ["Total Flights", "FNUM", 1, 15],
  ["Up/Down Reference", "U/D", 15, 7],
  ["TX Uplink Power", "TXPW", 24, 13],
  ["Watt Hours Drawn", "Wh", 1, 13],
  ["AUX Value", "AUX", 1, 12],
  ["Ready Mode", "RDY", 12, 5],
  ["RSNR", "RSNR", 1, 5],
  ["Goggle Voltage", "GVLT", 1, 1],
  ["VTX Voltage", "VVLT", 1, 2],
  ["Video Bitrate", "BITR", 1, 3],
  ["Video Delay", "DLY", 1, 4],
  ["Link Distance", "LDST", 1, 5],
  ["Link Quality (HD)", "HDLQ", 1, 6],
  ["Goggle DVR", "GDVR", 1, 7],
  ["VTX DVR", "VDVR", 1, 8],
  ["HD System Warnings", "HDWN", 1, 9],
  ["VTX Temperature", "VTMP", 1, 10],
  ["Fan Speed", "FAN", 1, 11],
  ["Lap Time Current", "LAPC", 1, 12],
  ["Lap Time Previous", "LAPP", 1, 13],
  ["Lap Time Best 3", "LAP3", 1, 14],
];

/** Elements a reset shows in profile 1. */
const DEFAULT_VISIBLE = new Set([0, 1, 2, 6, 7, 12, 21]);

export const BF_OSD_ELEMENT_DEFS: Array<{
  id: number;
  name: string;
  shortLabel: string;
  defaultX: number;
  defaultY: number;
}> = OSD_ITEMS.map(([name, shortLabel, defaultX, defaultY], id) => ({ id, name, shortLabel, defaultX, defaultY }));

/** Definition for an element id, including ids newer than this table. */
export function osdElementDef(id: number): (typeof BF_OSD_ELEMENT_DEFS)[number] {
  return BF_OSD_ELEMENT_DEFS[id] ?? { id, name: `Element ${id}`, shortLabel: `E${id}`, defaultX: 1, defaultY: 1 };
}

export const VIDEO_SYSTEM_OPTIONS = [
  { value: "AUTO", label: "AUTO" },
  { value: "PAL", label: "PAL (30x16)" },
  { value: "NTSC", label: "NTSC (30x13)" },
  { value: "HD", label: "HD (53x20)" },
];

/** Default layout for `count` elements (the FC's OSD_ITEM_COUNT, or the table size offline). */
export function buildDefaultElements(count = BF_OSD_ELEMENT_DEFS.length): BfOsdElement[] {
  return Array.from({ length: count }, (_, id) => {
    const def = osdElementDef(id);
    return {
      id,
      name: def.name,
      shortLabel: def.shortLabel,
      x: def.defaultX,
      y: def.defaultY,
      profiles: DEFAULT_VISIBLE.has(id) ? 1 : 0,
      variant: 0,
    };
  });
}

// ── Position encoding/decoding ──────────────────────────────
//
// Betaflight element position word (osd/osd.h OSD_POS / OSD_X / OSD_Y):
//   bits 0-4   x (low 5 bits)
//   bits 5-9   y
//   bit  10    x bit 5 (HD canvases wider than 32 columns)
//   bits 11-13 visible in OSD profile 1..3
//   bits 14-15 element variant (OSD_TYPE)

/** Encode an element into the U16 MSP_SET_OSD_CONFIG writes. */
export function encodePosition(el: BfOsdElement): number {
  return (
    (el.x & 0x1f) |
    ((el.x & 0x20) << 5) |
    ((el.y & 0x1f) << 5) |
    ((el.profiles & 0x07) << 11) |
    ((el.variant & 0x03) << 14)
  );
}

/** Decode a U16 MSP_OSD_CONFIG position word for element `id`. */
export function decodePosition(pos: number, id: number): BfOsdElement {
  const def = osdElementDef(id);
  return {
    id,
    name: def.name,
    shortLabel: def.shortLabel,
    x: (pos & 0x1f) | ((pos & 0x400) >> 5),
    y: (pos >> 5) & 0x1f,
    profiles: (pos >> 11) & 0x07,
    variant: (pos >> 14) & 0x03,
  };
}

/** Whether an element shows in the 1-based OSD profile. */
export function isVisibleInProfile(el: BfOsdElement, profile: number): boolean {
  return (el.profiles & (1 << (profile - 1))) !== 0;
}
