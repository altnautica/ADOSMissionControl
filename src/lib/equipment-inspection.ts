/**
 * Equipment inspection schedule. `inspectionIntervalHours` is a recurring
 * interval: an item is due once it has flown that many hours since its last
 * inspection (or since it entered service when never inspected).
 *
 * @license GPL-3.0-only
 */

import type { EquipmentItem } from "@/lib/types/operator";

/** Flight hours accumulated since the item was last marked inspected. */
export function hoursSinceInspection(item: EquipmentItem): number {
  return Math.max(0, (item.totalFlightHours ?? 0) - (item.hoursAtLastInspection ?? 0));
}

/** True when an inspection interval is set and has been flown through. */
export function isInspectionDue(item: EquipmentItem): boolean {
  if (item.inspectionIntervalHours === undefined) return false;
  return hoursSinceInspection(item) >= item.inspectionIntervalHours;
}
