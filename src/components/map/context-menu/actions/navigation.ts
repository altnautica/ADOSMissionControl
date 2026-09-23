/**
 * @module map/context-menu/actions/navigation
 * @description Navigation action handlers: fly-here and loiter. Land Here is
 * the reposition-then-land sequence in `@/lib/skills/guided-target`; the orbit
 * action defers to a sub-panel and is wired in the orchestrator.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
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
