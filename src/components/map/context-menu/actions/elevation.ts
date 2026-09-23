/**
 * @module map/context-menu/actions/elevation
 * @description Ground elevation (AMSL) of a clicked map point for the menu
 * commands whose altitude is absolute: set home, set EKF origin and point
 * camera. The lookup is bounded so a stalled terrain request cannot fire the
 * command long after the operator moved on; a timeout resolves to null and the
 * caller refuses the command.
 * @license GPL-3.0-only
 */

import { getElevation } from "@/lib/terrain/terrain-provider";
import type { MenuPosition, MenuReport } from "../types";

/** How long a menu command waits for the clicked point's terrain elevation. */
export const MENU_ELEVATION_TIMEOUT_MS = 5_000;

/** Resolve the clicked point's AMSL ground elevation, reporting the wait. */
export async function resolvePointElevation(
  menuPos: MenuPosition,
  report: MenuReport,
): Promise<number | null> {
  report("Resolving elevation…", "info");
  return getElevation(
    menuPos.lat,
    menuPos.lon,
    AbortSignal.timeout(MENU_ELEVATION_TIMEOUT_MS),
  );
}
