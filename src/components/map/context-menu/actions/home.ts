/**
 * @module map/context-menu/actions/home
 * @description Home and EKF origin action handlers. The set-home action goes
 * through a confirmation sub-panel; this handler is invoked from the panel
 * confirm button.
 *
 * Both commands take an ALTITUDE, and both used to hardcode `0`. It reaches
 * the wire as absolute AMSL — param7 of `MAV_CMD_DO_SET_HOME` and
 * `alt * 1000` in `SET_GPS_GLOBAL_ORIGIN` — so at a 900 m AMSL site the
 * flight controller's home altitude became sea level. Every altitude the
 * aircraft reports or holds relative to home is then 900 m out. The terrain
 * provider already answers for an arbitrary clicked point, so the elevation is
 * looked up (bounded by a timeout, so a stalled lookup never moves home a
 * minute later); when it cannot be resolved in time the command is REFUSED
 * rather than sent with a fabricated zero.
 *
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import { resolvePointElevation } from "./elevation";
import type { MenuPosition, MenuReport } from "../types";

interface HomeArgs {
  protocol: DroneProtocol | null;
  menuPos: MenuPosition;
  report: MenuReport;
}

export async function handleSetHomeConfirmed({
  protocol,
  menuPos,
  report,
}: HomeArgs): Promise<void> {
  if (!protocol) {
    report("No drone connected", "error");
    return;
  }
  const elevation = await resolvePointElevation(menuPos, report);
  if (elevation === null) {
    report(
      "Home not set: terrain elevation for that point is unavailable or timed out, and home altitude is AMSL",
      "error",
    );
    return;
  }
  const result = await protocol.setHome(false, menuPos.lat, menuPos.lon, elevation);
  report(
    result.success
      ? `Home set at ${elevation.toFixed(0)} m AMSL`
      : `Set home failed: ${result.message}`,
    result.success ? "success" : "error",
  );
}

export async function handleSetEkfOrigin({
  protocol,
  menuPos,
  report,
}: HomeArgs): Promise<void> {
  if (!protocol?.setEkfOrigin) {
    report("This firmware does not support setting the EKF origin", "error");
    return;
  }
  const elevation = await resolvePointElevation(menuPos, report);
  if (elevation === null) {
    report(
      "EKF origin not set: terrain elevation for that point is unavailable or timed out, and the origin altitude is AMSL",
      "error",
    );
    return;
  }
  const result = await protocol.setEkfOrigin(menuPos.lat, menuPos.lon, elevation);
  report(result.message, result.success ? "success" : "error");
}
