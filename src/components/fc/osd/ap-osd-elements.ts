/**
 * ArduPilot OSD element table and parameter naming.
 *
 * Each on-screen item on screen n is three parameters: OSDn_<ITEM>_EN (0/1),
 * OSDn_<ITEM>_X (column) and OSDn_<ITEM>_Y (row). The item names are the
 * AP_OSD_Screen parameter group names. Which items exist depends on the
 * build, so every one is loaded as optional.
 *
 * @license GPL-3.0-only
 */

export interface OsdElement {
  /** AP_OSD_Screen item name, e.g. "BAT_VOLT". */
  id: string;
  label: string;
  shortLabel: string;
  enabled: boolean;
  row: number;
  col: number;
}

export type VideoFormat = "PAL" | "NTSC";

/** Screens OSD1..OSD4 carry display elements. */
export const OSD_SCREENS = [1, 2, 3, 4] as const;

/** ArduPilot limits OSDn_<ITEM>_X to 0..59 and _Y to 0..21. */
export const OSD_MAX_COL = 59;
export const OSD_MAX_ROW = 21;

interface OsdElementDef {
  id: string;
  label: string;
  shortLabel: string;
  row: number;
  col: number;
}

export const AP_OSD_ELEMENTS: OsdElementDef[] = [
  { id: "ALTITUDE", label: "Altitude", shortLabel: "ALT", row: 1, col: 1 },
  { id: "BAT_VOLT", label: "Battery Voltage", shortLabel: "BATT", row: 1, col: 23 },
  { id: "RSSI", label: "RSSI", shortLabel: "RSSI", row: 0, col: 26 },
  { id: "CURRENT", label: "Current", shortLabel: "AMP", row: 2, col: 23 },
  { id: "SATS", label: "GPS Satellites", shortLabel: "SAT", row: 0, col: 1 },
  { id: "FLTMODE", label: "Flight Mode", shortLabel: "MODE", row: 14, col: 12 },
  { id: "MESSAGE", label: "Messages", shortLabel: "MSG", row: 13, col: 1 },
  { id: "GSPEED", label: "Ground Speed", shortLabel: "GS", row: 8, col: 1 },
  { id: "HORIZON", label: "Horizon", shortLabel: "HOR", row: 7, col: 12 },
  { id: "COMPASS", label: "Compass", shortLabel: "CMP", row: 14, col: 1 },
  { id: "WIND", label: "Wind", shortLabel: "WND", row: 3, col: 1 },
  { id: "ASPEED", label: "Air Speed", shortLabel: "AS", row: 9, col: 1 },
  { id: "VSPEED", label: "Vertical Speed", shortLabel: "VS", row: 10, col: 1 },
  { id: "THROTTLE", label: "Throttle", shortLabel: "THR", row: 8, col: 23 },
  { id: "HEADING", label: "Heading", shortLabel: "HDG", row: 0, col: 12 },
  { id: "HOMEDIST", label: "Home Distance", shortLabel: "DIST", row: 14, col: 23 },
  { id: "HOMEDIR", label: "Home Direction", shortLabel: "DIR", row: 13, col: 23 },
  { id: "POWER", label: "Power", shortLabel: "PWR", row: 3, col: 23 },
  { id: "CELLVOLT", label: "Cell Voltage", shortLabel: "CELL", row: 4, col: 23 },
  { id: "BATTBAR", label: "Battery Bar", shortLabel: "BAR", row: 5, col: 23 },
  { id: "ARMING", label: "Arming Status", shortLabel: "ARM", row: 6, col: 12 },
  { id: "CLIMBEFF", label: "Climb Efficiency", shortLabel: "CE", row: 11, col: 1 },
  { id: "EFF", label: "Efficiency", shortLabel: "EFF", row: 12, col: 1 },
  { id: "BATUSED", label: "Battery Used", shortLabel: "mAh", row: 3, col: 23 },
  { id: "CLK", label: "Clock", shortLabel: "CLK", row: 0, col: 22 },
  { id: "ROLL", label: "Roll Angle", shortLabel: "ROLL", row: 6, col: 1 },
  { id: "PITCH", label: "Pitch Angle", shortLabel: "PTCH", row: 7, col: 1 },
];

/** The three parameters that place one element on one screen. */
export function osdElementParams(screen: number, id: string): { en: string; x: string; y: string } {
  const base = `OSD${screen}_${id}`;
  return { en: `${base}_EN`, x: `${base}_X`, y: `${base}_Y` };
}

/** Every element parameter for a screen, plus the screen's own enable switch. */
export function osdScreenParamNames(screen: number): string[] {
  const names = [`OSD${screen}_ENABLE`];
  for (const el of AP_OSD_ELEMENTS) {
    const p = osdElementParams(screen, el.id);
    names.push(p.en, p.x, p.y);
  }
  return names;
}

export const PRESETS: Record<string, Partial<Record<string, { enabled: boolean; row: number; col: number }>>> = {
  Racing: {
    ALTITUDE: { enabled: true, row: 1, col: 1 },
    BAT_VOLT: { enabled: true, row: 1, col: 24 },
    RSSI: { enabled: true, row: 0, col: 26 },
    FLTMODE: { enabled: true, row: 14, col: 12 },
    THROTTLE: { enabled: true, row: 8, col: 24 },
    ARMING: { enabled: true, row: 7, col: 12 },
  },
  Cruise: {
    ALTITUDE: { enabled: true, row: 1, col: 1 },
    BAT_VOLT: { enabled: true, row: 1, col: 23 },
    RSSI: { enabled: true, row: 0, col: 26 },
    SATS: { enabled: true, row: 0, col: 1 },
    FLTMODE: { enabled: true, row: 14, col: 12 },
    GSPEED: { enabled: true, row: 8, col: 1 },
    HEADING: { enabled: true, row: 0, col: 12 },
    HOMEDIST: { enabled: true, row: 14, col: 23 },
    HORIZON: { enabled: true, row: 7, col: 12 },
    COMPASS: { enabled: true, row: 14, col: 1 },
    VSPEED: { enabled: true, row: 10, col: 1 },
    CURRENT: { enabled: true, row: 2, col: 23 },
    BATUSED: { enabled: true, row: 3, col: 23 },
    MESSAGE: { enabled: true, row: 13, col: 1 },
    ARMING: { enabled: true, row: 7, col: 12 },
  },
  Minimal: {
    BAT_VOLT: { enabled: true, row: 0, col: 24 },
    FLTMODE: { enabled: true, row: 14, col: 12 },
    ARMING: { enabled: true, row: 7, col: 12 },
  },
};
