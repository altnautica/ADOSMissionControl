/**
 * @module hud/minimap-mode
 * @description Which frame the cockpit minimap draws: the global tile map or
 * the local north/east frame. Local mode is chosen when the GPS fix has been
 * below 3D for more than 2 s, when the active EKF horizontal-position source
 * is ExternalNav or None, or when the operator pinned it. A pinned MAP always
 * wins over the automatic rules.
 *
 * @license GPL-3.0-only
 */

/** The operator's header toggle, persisted per vehicle. */
export type MinimapPin = "auto" | "local" | "map";
export type MinimapFrame = "local" | "global";
/** Why local mode is active; `null` in global mode. */
export type MinimapLocalReason = "pinned" | "noFix" | "posxySource" | null;

/** A fix below 3D must hold this long before the minimap switches. */
export const MINIMAP_NO_FIX_HOLD_MS = 2000;

/** EK3_SRCn_POSXY values that carry no GNSS position. */
const LOCAL_POSXY_SOURCES: ReadonlySet<number> = new Set([0, 6]);

/**
 * Track when the GPS fix dropped below 3D. Returns the start of the current
 * low-fix run, or null while the fix is 3D or better or no fresh fix is known.
 */
export function nextNoFixSince(
  prevSince: number | null,
  fixType: number | null,
  now: number,
): number | null {
  if (fixType === null || fixType >= 3) return null;
  return prevSince ?? now;
}

export interface MinimapModeInput {
  pin: MinimapPin;
  /** Start of the current below-3D run (see {@link nextNoFixSince}). */
  noFixSince: number | null;
  now: number;
  /** `EK3_SRC<active>_POSXY`, or null when the parameters are not loaded. */
  activePosxy: number | null;
}

export function resolveMinimapMode(input: MinimapModeInput): {
  frame: MinimapFrame;
  reason: MinimapLocalReason;
} {
  if (input.pin === "map") return { frame: "global", reason: null };
  if (input.pin === "local") return { frame: "local", reason: "pinned" };
  if (input.activePosxy !== null && LOCAL_POSXY_SOURCES.has(input.activePosxy)) {
    return { frame: "local", reason: "posxySource" };
  }
  if (input.noFixSince !== null && input.now - input.noFixSince > MINIMAP_NO_FIX_HOLD_MS) {
    return { frame: "local", reason: "noFix" };
  }
  return { frame: "global", reason: null };
}

/** `EK3_SRC<set>_POSXY` from the loaded source parameters, or null. */
export function activePosxySource(
  params: Readonly<Record<string, number>> | null,
  activeSet: 1 | 2 | 3,
): number | null {
  const v = params?.[`EK3_SRC${activeSet}_POSXY`];
  return typeof v === "number" ? v : null;
}
