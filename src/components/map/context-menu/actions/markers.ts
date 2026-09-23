/**
 * @module map/context-menu/actions/markers
 * @description Marker action handlers: rally points, POI markers, set-heading.
 * The add-rally and add-poi actions go through sub-panels; this module exposes
 * the confirm handlers those panels call.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import type { RallyPoint, RallyTransferResult } from "@/stores/rally-store";
import { bearing } from "@/lib/telemetry-utils";
import type { MenuPosition, MenuReport } from "../types";

/**
 * The vehicle's return altitude in metres, the default for a new rally point
 * (the FC loiters over a rally point at the point's own altitude). `null` when
 * the parameter cannot be read or means "current altitude" — the operator then
 * types one; the current altitude is never used, since on the ground it is 0.
 */
export async function readReturnAltitude(protocol: DroneProtocol | null): Promise<number | null> {
  if (!protocol) return null;
  const firmware = protocol.getVehicleInfo()?.firmwareType;
  // [parameter, scale to metres]
  const source: [string, number] =
    firmware === "px4"
      ? ["RTL_RETURN_ALT", 1]
      : firmware === "ardupilot-plane"
        ? ["ALT_HOLD_RTL", 0.01]
        : ["RTL_ALT", 0.01];
  try {
    const value = (await protocol.getParameter(source[0])).value * source[1];
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

interface AddRallyArgs {
  menuPos: MenuPosition;
  /** Operator-confirmed altitude, metres relative to home. */
  alt: number;
  addRally: (point: RallyPoint) => void;
  uploadRally: () => Promise<RallyTransferResult>;
  report: MenuReport;
}

/** Add the rally point, upload the rally set, and report what the FC said. */
export async function handleAddRallyConfirmed({
  menuPos,
  alt,
  addRally,
  uploadRally,
  report,
}: AddRallyArgs): Promise<void> {
  addRally({ id: `rally-${Date.now()}`, lat: menuPos.lat, lon: menuPos.lon, alt });
  const r = await uploadRally();
  report(
    r.success ? `Rally point added at ${Math.round(alt)} m and uploaded` : `Rally upload failed: ${r.message}`,
    r.success ? "success" : "error",
  );
}

interface AddPoiArgs {
  menuPos: MenuPosition;
  label: string;
  addPoi: (lat: number, lon: number, label: string) => void;
}

export function handleAddPoiConfirmed({ menuPos, label, addPoi }: AddPoiArgs): void {
  addPoi(menuPos.lat, menuPos.lon, label);
}

interface SetHeadingArgs {
  protocol: DroneProtocol | null;
  menuPos: MenuPosition;
  fromLat: number;
  fromLon: number;
  report: MenuReport;
}

/** Yaw rate for Set Heading Toward, deg/s. */
const SET_HEADING_RATE_DPS = 30;

/**
 * Turn the vehicle to face the clicked point (MAV_CMD_CONDITION_YAW, absolute
 * heading). Direction 0 lets the autopilot take the shortest turn; a fixed
 * clockwise direction turned 350° to reach a heading 10° to the left.
 */
export async function handleSetHeading({
  protocol,
  menuPos,
  fromLat,
  fromLon,
  report,
}: SetHeadingArgs): Promise<void> {
  if (!protocol) {
    report("No drone connected", "error");
    return;
  }
  const brng = bearing(fromLat, fromLon, menuPos.lat, menuPos.lon);
  let success = false;
  let message = "";
  try {
    const result = await protocol.setYaw(brng, SET_HEADING_RATE_DPS, 0, false);
    success = result.success;
    message = result.message;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  report(
    success ? `Turning to heading ${Math.round(brng)}°` : `Set heading failed: ${message}`,
    success ? "success" : "error",
  );
}
