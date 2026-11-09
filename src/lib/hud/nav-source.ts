/**
 * @module hud/nav-source
 * @description What the EKF navigates on, as one chip: a source (DR, EXT NAV,
 * GPS, FLOW), a quality word and a tone. Inputs are the FC's
 * EKF_STATUS_REPORT flags, the GPS fix, the EKF source-set parameters and the
 * vision-nav `nav.state`. Pure; every surface renders its result.
 *
 * @license GPL-3.0-only
 */

import type { NavState } from "./nav-types";

/** EKF_STATUS_REPORT flag bits the chip reads. */
export const EKF_FLAG = {
  VEL_H: 2,
  POS_H_REL: 8,
  POS_H_ABS: 16,
  CONST_POS: 128,
  GPS_GLITCH: 1024,
} as const;

/** EK3_SRCn_* source values. */
export const EKF_SRC = {
  NONE: 0,
  GPS: 3,
  BEACON: 4,
  OPTICAL_FLOW: 5,
  EXTERNAL_NAV: 6,
  WHEEL_ENCODER: 7,
} as const;

export const EKF_STALE_MS = 2000;

export type NavSourceKind = "dr" | "ext" | "gps" | "flow" | "stale";
export type NavQuality =
  | "good"
  | "fair"
  | "poor"
  | "degraded"
  | "lost"
  | "noFix"
  | "glitch"
  | "holdOk"
  | "noFlow"
  | "drift";
export type NavTone = "good" | "warn" | "crit" | "muted";
export type GpsFixWord = "none" | "2d" | "3d" | "dgps" | "rtkFloat" | "rtkFixed";

export interface NavSourceInput {
  /** Latest EKF_STATUS_REPORT flags and its age (ms), or null. */
  ekf: { flags: number; ageMs: number } | null;
  gps: { fixType: number; satellites?: number; hdop?: number } | null;
  /** Fresh vision-nav state, or null when absent or stale. */
  nav: NavState | null;
  /** The set this GCS last commanded, or null. */
  lastCommandedSet: 1 | 2 | 3 | null;
  /** EK3_SRC{1,2,3}_{POSXY,VELXY,YAW} values; null when not loaded. */
  params: Readonly<Record<string, number>> | null;
}

export interface NavSourceResult {
  kind: NavSourceKind;
  quality: NavQuality | null;
  tone: NavTone;
  activeSet: 1 | 2 | 3;
  /** GPS rows: the fix word and satellite count. */
  fix?: GpsFixWord;
  sats?: number;
}

export function gpsFixWord(fixType: number): GpsFixWord {
  switch (fixType) {
    case 2:
      return "2d";
    case 3:
      return "3d";
    case 4:
      return "dgps";
    case 5:
      return "rtkFloat";
    case 6:
      return "rtkFixed";
    default:
      return "none";
  }
}

/** The active EKF source set: vision-nav's report, else the GCS's last
 * command, else 1 (ArduPilot's boot default). */
export function activeSourceSet(nav: NavState | null, lastCommanded: 1 | 2 | 3 | null): 1 | 2 | 3 {
  return nav?.activeSet ?? lastCommanded ?? 1;
}

function gpsRow(
  flags: number,
  gps: NavSourceInput["gps"],
  activeSet: 1 | 2 | 3,
): NavSourceResult {
  const fixType = gps?.fixType ?? 0;
  const base = { kind: "gps" as const, activeSet, fix: gpsFixWord(fixType), sats: gps?.satellites };
  if (fixType < 3) return { ...base, quality: "noFix", tone: "crit" };
  if (flags & EKF_FLAG.GPS_GLITCH) return { ...base, quality: "glitch", tone: "warn" };
  const hdop = gps?.hdop;
  if (hdop !== undefined && hdop < 1.5) return { ...base, quality: "good", tone: "good" };
  if (hdop !== undefined && hdop >= 2.5) return { ...base, quality: "poor", tone: "warn" };
  return { ...base, quality: "fair", tone: "warn" };
}

function extRow(flags: number, nav: NavState | null, activeSet: 1 | 2 | 3): NavSourceResult {
  const h = nav?.extnavHealth ?? null;
  if (h === "good") return { kind: "ext", quality: "good", tone: "good", activeSet };
  if (h === "degraded") return { kind: "ext", quality: "degraded", tone: "warn", activeSet };
  if (h === "lost") return { kind: "ext", quality: "lost", tone: "crit", activeSet };
  return flags & (EKF_FLAG.POS_H_ABS | EKF_FLAG.POS_H_REL)
    ? { kind: "ext", quality: "good", tone: "good", activeSet }
    : { kind: "ext", quality: "noFix", tone: "crit", activeSet };
}

function flowRow(flags: number, activeSet: 1 | 2 | 3): NavSourceResult {
  return flags & EKF_FLAG.VEL_H
    ? { kind: "flow", quality: "holdOk", tone: "good", activeSet }
    : { kind: "flow", quality: "noFlow", tone: "crit", activeSet };
}

/** Resolve the nav-source chip. */
export function resolveNavSource(input: NavSourceInput): NavSourceResult {
  const activeSet = activeSourceSet(input.nav, input.lastCommandedSet);
  const { ekf } = input;
  if (!ekf || ekf.ageMs > EKF_STALE_MS) {
    return { kind: "stale", quality: null, tone: "muted", activeSet };
  }
  const f = ekf.flags;
  const anyPos = f & (EKF_FLAG.VEL_H | EKF_FLAG.POS_H_REL | EKF_FLAG.POS_H_ABS);
  if (f & EKF_FLAG.CONST_POS || !anyPos) {
    return { kind: "dr", quality: "drift", tone: "crit", activeSet };
  }

  const posxy = input.params?.[`EK3_SRC${activeSet}_POSXY`];
  const velxy = input.params?.[`EK3_SRC${activeSet}_VELXY`];
  if (posxy === EKF_SRC.EXTERNAL_NAV) return extRow(f, input.nav, activeSet);
  if (posxy === EKF_SRC.GPS) return gpsRow(f, input.gps, activeSet);
  if (posxy === EKF_SRC.NONE && velxy === EKF_SRC.OPTICAL_FLOW) return flowRow(f, activeSet);

  // Parameters unknown (or a source the chip has no row for): derive from
  // the flags and the companion's report.
  if (f & EKF_FLAG.POS_H_ABS && (input.gps?.fixType ?? 0) >= 3) {
    return gpsRow(f, input.gps, activeSet);
  }
  if (input.nav?.mode === "external_nav" && input.nav.extnavHealth !== null) {
    return extRow(f, input.nav, activeSet);
  }
  if (f & EKF_FLAG.POS_H_REL) return extRow(f, input.nav, activeSet);
  return flowRow(f, activeSet);
}

const FIX_EN: Record<GpsFixWord, string> = {
  none: "NO FIX",
  "2d": "2D",
  "3d": "3D",
  dgps: "DGPS",
  rtkFloat: "RTK FLT",
  rtkFixed: "RTK FIX",
};

const QUALITY_EN: Record<NavQuality, string> = {
  good: "GOOD",
  fair: "FAIR",
  poor: "POOR",
  degraded: "DEGRADED",
  lost: "LOST",
  noFix: "NO FIX",
  glitch: "GLITCH",
  holdOk: "HOLD OK",
  noFlow: "NO FLOW",
  drift: "DRIFT",
};

/** English label and quality word, matching the `hud.nav.*` keys. */
export function navSourceTextEn(r: NavSourceResult): { label: string; word: string | null } {
  const word = r.quality ? QUALITY_EN[r.quality] : null;
  switch (r.kind) {
    case "stale":
      return { label: "NAV —", word: null };
    case "dr":
      return { label: "DR", word };
    case "ext":
      return { label: "EXT NAV", word };
    case "flow":
      return { label: "FLOW", word };
    case "gps": {
      const fix = FIX_EN[r.fix ?? "none"];
      return { label: r.sats !== undefined ? `GPS ${fix}·${r.sats}` : `GPS ${fix}`, word };
    }
  }
}

/** Decoded EK3_SRC value word key (`hud.nav.src.<n>`). */
export function sourceValueKey(v: number | undefined): string {
  return v !== undefined && v >= 0 && v <= 7 ? String(v) : "unknown";
}
