/**
 * @module fc-item-count
 * @description Advisory check for flight-controller mission item-count limits.
 *
 * Flight controllers store a mission as a fixed-size list of items. When a plan
 * approaches (or exceeds) that firmware's storage ceiling, the upload can be
 * truncated or rejected by the FC. This module estimates how many items a plan
 * uploads and reports an ADVISORY (never a hard error) so the operator can trim
 * the mission before attempting an upload.
 *
 * Pure logic: no React / store / Leaflet imports, fully unit-testable.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import type { FirmwareType } from "@/lib/protocol/types/enums";

/** Firmware families that share a common item-count ceiling. */
export type FcFamily = "ardupilot" | "px4" | "betaflight" | "inav";

/**
 * Per-firmware default item-count ceilings.
 *
 * These are advisory best-effort defaults, not authoritative per-board limits
 * (real ceilings depend on FC storage, parameters, and board revision):
 *  - ArduPilot: ~700-item storage default on common boards.
 *  - PX4: the dataman mission store is sized by the build option
 *    NUM_MISSION_ITEMS_SUPPORTED, default 500.
 *  - iNav: NAV_MAX_WAYPOINTS, 120 on the common targets.
 *  - Betaflight: no mission storage; kept small so a plan reads as unfit.
 */
export const FC_ITEM_COUNT_LIMITS: Record<FcFamily, number> = {
  ardupilot: 724,
  px4: 500,
  betaflight: 60,
  inav: 120,
};

/** Fallback ceiling when no firmware or explicit limit is supplied. */
export const DEFAULT_FC_ITEM_LIMIT = FC_ITEM_COUNT_LIMITS.ardupilot;

/**
 * Fraction of the limit at or above which the advisory escalates to `warn`.
 * Below this the advisory stays informational. A plan at 90% of the ceiling is
 * close enough that adding a few waypoints would overflow the FC store.
 */
export const ITEM_COUNT_WARN_RATIO = 0.9;

/** Options for {@link checkItemCount}. */
export interface ItemCountOptions {
  /**
   * Explicit item ceiling. When a positive number is supplied it overrides the
   * firmware-derived default.
   */
  limit?: number;
  /**
   * Connected firmware whose default ceiling applies when `limit` is absent.
   * Unknown firmware falls back to {@link DEFAULT_FC_ITEM_LIMIT}.
   */
  firmware?: FirmwareType;
}

/** Advisory result. `level` is always `info` or `warn`; never an error. */
export interface ItemCountAdvisory {
  /** Estimated number of mission items the plan uploads. */
  count: number;
  /** Ceiling the count was compared against. */
  limit: number;
  /** `warn` once the count approaches or exceeds the ceiling, else `info`. */
  level: "info" | "warn";
}

/**
 * Map a full {@link FirmwareType} to its {@link FcFamily}, or `null` when the
 * firmware is unknown / unmapped.
 */
export function fcFamilyFromFirmware(firmware: FirmwareType): FcFamily | null {
  if (firmware.startsWith("ardupilot")) return "ardupilot";
  if (firmware === "px4") return "px4";
  if (firmware === "betaflight") return "betaflight";
  if (firmware === "inav") return "inav";
  return null;
}

/** Resolve the default item ceiling for a firmware type. */
export function limitForFirmware(firmware: FirmwareType): number {
  const family = fcFamilyFromFirmware(firmware);
  return family ? FC_ITEM_COUNT_LIMITS[family] : DEFAULT_FC_ITEM_LIMIT;
}

/**
 * Estimate the number of mission items a plan uploads to the FC.
 *
 * Each navigation waypoint uploads as one MAVLink mission item, and each action
 * attached to it (camera trigger, set speed, yaw, delay, jump, …) uploads as its
 * own sibling item right after it. The HOME item (sequence 0) is implicit — the
 * FC injects it — so it is not counted here. The estimate therefore matches the
 * flattened upload: the sum over waypoints of `1 + (attached action count)`.
 */
export function expandedItemCount(waypoints: readonly Waypoint[] | null | undefined): number {
  if (!Array.isArray(waypoints)) return 0;
  return waypoints.reduce((total, wp) => total + 1 + (wp.actions?.length ?? 0), 0);
}

function resolveLimit(options: ItemCountOptions): number {
  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
    return options.limit;
  }
  if (options.firmware) return limitForFirmware(options.firmware);
  return DEFAULT_FC_ITEM_LIMIT;
}

/**
 * Advise on the mission item count relative to a firmware's storage ceiling.
 *
 * The result is always advisory: `level` is `warn` once the estimated item
 * count reaches {@link ITEM_COUNT_WARN_RATIO} of the ceiling (which also covers
 * exceeding it), otherwise `info`. It is never an error — a plan that overflows
 * the FC store is still surfaced as a `warn`, leaving the upload decision to the
 * operator.
 */
export function checkItemCount(
  waypoints: readonly Waypoint[] | null | undefined,
  options: ItemCountOptions = {},
): ItemCountAdvisory {
  const count = expandedItemCount(waypoints);
  const limit = resolveLimit(options);
  const level: "info" | "warn" = count >= limit * ITEM_COUNT_WARN_RATIO ? "warn" : "info";
  return { count, limit, level };
}
