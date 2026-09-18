/**
 * @module map/context-menu/actions/navigation
 * @description Navigation action handlers: fly-here, loiter, land. The orbit
 * action defers to a sub-panel and is wired in the orchestrator.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import type { MenuPosition, MenuReport } from "../types";

interface FlyHereArgs {
  menuPos: MenuPosition;
  rectLeft: number;
  rectTop: number;
  showConfirm: (lat: number, lon: number, screenX: number, screenY: number) => void;
}

export function handleFlyHere({ menuPos, rectLeft, rectTop, showConfirm }: FlyHereArgs): void {
  showConfirm(menuPos.lat, menuPos.lon, rectLeft + menuPos.x, rectTop + menuPos.y);
}

interface LoiterArgs {
  protocol: DroneProtocol | null;
  menuPos: MenuPosition;
  relativeAlt: number | undefined;
  report: MenuReport;
}

export async function handleLoiterHere({
  protocol,
  menuPos,
  relativeAlt,
  report,
}: LoiterArgs): Promise<void> {
  if (!protocol) {
    report("No drone connected", "error");
    return;
  }
  const mode = await protocol.setFlightMode("LOITER");
  if (!mode.success) {
    report(`Loiter failed: ${mode.message}`, "error");
    return;
  }
  const goto = await protocol.guidedGoto(menuPos.lat, menuPos.lon, relativeAlt ?? 10);
  report(
    goto.success ? "Loitering at the selected point" : `Reposition failed: ${goto.message}`,
    goto.success ? "success" : "error",
  );
}

/**
 * Land at the clicked point.
 *
 * This used to reposition and then fire a target-less `MAV_CMD_NAV_LAND` on a
 * 500 ms `setTimeout`: at 5 m/s the aircraft had moved ~2.5 m and then landed
 * essentially where it started, under a menu item labelled "Land Here". The
 * reposition was also ack-tracked and could be REJECTED while the land fired
 * regardless. Now the reposition gates the land, and the land carries the
 * landing position itself so the FC descends at the commanded point.
 */
export async function handleLandHere({
  protocol,
  menuPos,
  relativeAlt,
  report,
}: LoiterArgs): Promise<void> {
  if (!protocol) {
    report("No drone connected", "error");
    return;
  }
  const goto = await protocol.guidedGoto(menuPos.lat, menuPos.lon, relativeAlt ?? 10);
  if (!goto.success) {
    report(`Land here failed — reposition rejected: ${goto.message}`, "error");
    return;
  }
  const land = await protocol.land({ lat: menuPos.lat, lon: menuPos.lon });
  report(
    land.success ? "Landing at the selected point" : `Land failed: ${land.message}`,
    land.success ? "success" : "error",
  );
}
