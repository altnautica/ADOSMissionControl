/**
 * @module map/context-menu/actions/navigation
 * @description Navigation action handlers: fly-here, and launch-here on the
 * ground. Land Here and Loiter Here are the reposition-then-land /
 * reposition-then-LOITER sequences in
 * `@/lib/skills/guided-target`; the orbit action defers to a sub-panel and is
 * wired in the orchestrator.
 * @license GPL-3.0-only
 */

import type { GuidedConfirmPending } from "@/stores/guided-store";
import type { LaunchRequest } from "@/stores/launch-request-store";
import { latLonToNed } from "../../map-point";
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

interface LaunchHereArgs {
  droneId: string | null;
  menuPos: MenuPosition;
  /** The vehicle's EKF origin, the frame of the Launch go-to. */
  origin: { lat: number; lon: number } | null;
  requestLaunch: (request: LaunchRequest) => void;
  report: MenuReport;
}

/** Ask the cockpit Launch sheet to open with the point as its go-to. */
export function handleLaunchHere({ droneId, menuPos, origin, requestLaunch, report }: LaunchHereArgs): void {
  if (!droneId) {
    report("No drone connected", "error");
    return;
  }
  if (!origin) {
    report("Launch here needs the vehicle's EKF origin", "warning");
    return;
  }
  const [north, east] = latLonToNed(origin, menuPos.lat, menuPos.lon);
  requestLaunch({ droneId, lat: menuPos.lat, lon: menuPos.lon, north, east });
}
