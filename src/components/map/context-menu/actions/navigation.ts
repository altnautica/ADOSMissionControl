/**
 * @module map/context-menu/actions/navigation
 * @description Navigation action handler: fly-here. Land Here and Loiter Here
 * are the reposition-then-land / reposition-then-LOITER sequences in
 * `@/lib/skills/guided-target`; the orbit action defers to a sub-panel and is
 * wired in the orchestrator.
 * @license GPL-3.0-only
 */

import type { GuidedConfirmPending } from "@/stores/guided-store";
import type { MenuPosition, MenuReport } from "../types";

interface FlyHereArgs {
  droneId: string | null;
  menuPos: MenuPosition;
  rectLeft: number;
  rectTop: number;
  showConfirm: (pending: GuidedConfirmPending) => void;
  report: MenuReport;
}

export function handleFlyHere({ droneId, menuPos, rectLeft, rectTop, showConfirm, report }: FlyHereArgs): void {
  if (!droneId) {
    report("No drone connected", "error");
    return;
  }
  showConfirm({
    droneId,
    lat: menuPos.lat,
    lon: menuPos.lon,
    screenX: rectLeft + menuPos.x,
    screenY: rectTop + menuPos.y,
  });
}
