/**
 * @module skills/guided-target
 * @description Owns the lifecycle of the active guided target: Fly Here and the
 * Land Here sequence.
 *
 * A reposition (MAV_CMD_DO_REPOSITION) is acked when the autopilot accepts it,
 * not when the vehicle arrives, and ArduCopter handles MAV_CMD_NAV_LAND by
 * switching to LAND at its current position. So "land at this point" is a
 * sequence the GCS has to run itself: reposition, watch the selected drone's
 * position once a second, and send the land only once the vehicle is holding
 * over the point. The same supervisor clears a Fly Here target when the
 * vehicle arrives or leaves the reposition mode, so the overlay never keeps
 * reporting a flight that is no longer happening.
 *
 * @license GPL-3.0-only
 */

import type { DroneProtocol, UnifiedFlightMode } from "@/lib/protocol/types";
import { freshOnly } from "@/lib/telemetry/freshness";
import { haversineDistance } from "@/lib/telemetry-utils";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useGuidedStore, type GuidedTarget } from "@/stores/guided-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

/** Supervision cadence. */
export const GUIDED_POLL_MS = 1_000;
/** Land Here descends only within this horizontal distance of the point... */
export const LAND_ARRIVAL_RADIUS_M = 2;
/** ...and below this ground speed, so the vehicle is holding, not passing. */
export const LAND_ARRIVAL_MAX_SPEED_MS = 1;
/** Land Here gives up if the vehicle has not settled over the point by then. */
export const LAND_REPOSITION_TIMEOUT_MS = 180_000;
/** A Fly Here target is reached inside this radius. */
const GOTO_ARRIVAL_RADIUS_M = 5;
/**
 * Heartbeats arrive at about 1 Hz, so the mode the reposition switched to can
 * lag the ack. Until the vehicle has been seen in that mode, a different mode
 * only ends the target once this long has passed.
 */
const MODE_ENTRY_GRACE_MS = 3_000;

export type GuidedReport = (
  message: string,
  status: "success" | "warning" | "error" | "info",
) => void;

interface Session {
  target: GuidedTarget;
  protocol: DroneProtocol;
  report: GuidedReport;
  /** The mode DO_REPOSITION puts this firmware in. */
  repositionMode: UnifiedFlightMode;
  seenRepositionMode: boolean;
  /** The land command is in flight; no further checks run. */
  landing: boolean;
}

let session: Session | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Stop supervising and clear the target without sending anything. The caller
 * that cancels on the operator's behalf sends the stop itself.
 */
export function cancelGuidedTarget(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  session = null;
  useGuidedStore.getState().clearTarget();
}

/** End the target on a condition the operator did not ask for, and say why. */
function abandon(s: Session, reason: string): void {
  cancelGuidedTarget();
  if (s.target.purpose === "land") {
    s.report(`Land here cancelled: ${reason}`, "warning");
  }
}

async function descend(s: Session): Promise<void> {
  s.landing = true;
  let success = false;
  let message = "";
  try {
    const result = await s.protocol.land({ lat: s.target.lat, lon: s.target.lon });
    success = result.success;
    message = result.message;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  // Cancelled or replaced while the land was in flight.
  if (session !== s) return;
  cancelGuidedTarget();
  s.report(
    success ? "Landing at the selected point" : `Land failed: ${message}`,
    success ? "success" : "error",
  );
}

function tick(): void {
  const s = session;
  if (!s || s.landing) return;
  const now = Date.now();
  const { target } = s;

  // Telemetry and mode below are the selected drone's; once the operator
  // selects another one this target can no longer be watched.
  if (useDroneManager.getState().selectedDroneId !== target.droneId) {
    abandon(s, "a different drone was selected");
    return;
  }

  const mode = useDroneStore.getState().flightMode;
  if (mode === s.repositionMode) {
    s.seenRepositionMode = true;
  } else if (s.seenRepositionMode || now - target.timestamp > MODE_ENTRY_GRACE_MS) {
    abandon(s, `flight mode changed to ${mode}`);
    return;
  }

  if (target.purpose === "land" && now - target.timestamp >= LAND_REPOSITION_TIMEOUT_MS) {
    abandon(s, "the vehicle did not settle over the point in time");
    return;
  }

  const pos = freshOnly(useTelemetryStore.getState().position.latest(), now);
  if (!pos) return;
  const distance = haversineDistance(pos.lat, pos.lon, target.lat, target.lon);

  if (target.purpose === "goto") {
    if (distance < GOTO_ARRIVAL_RADIUS_M) cancelGuidedTarget();
    return;
  }
  if (distance <= LAND_ARRIVAL_RADIUS_M && pos.groundSpeed < LAND_ARRIVAL_MAX_SPEED_MS) {
    void descend(s);
  }
}

/**
 * Start supervising a target the vehicle has just accepted a reposition to.
 * Replaces any target already active.
 */
export function superviseGuidedTarget(
  target: GuidedTarget,
  protocol: DroneProtocol,
  report: GuidedReport,
): void {
  cancelGuidedTarget();
  session = {
    target,
    protocol,
    report,
    repositionMode: protocol.getVehicleInfo()?.firmwareType === "px4" ? "LOITER" : "GUIDED",
    seenRepositionMode: false,
    landing: false,
  };
  useGuidedStore.getState().setTarget(target);
  timer = setInterval(tick, GUIDED_POLL_MS);
}

interface LandAtPointArgs {
  protocol: DroneProtocol | null;
  droneId: string | null;
  lat: number;
  lon: number;
  /** Altitude to reposition at, metres relative to home. */
  alt: number;
  report: GuidedReport;
}

/**
 * Land Here: reposition to the point, then land once the vehicle is holding
 * within {@link LAND_ARRIVAL_RADIUS_M} of it below
 * {@link LAND_ARRIVAL_MAX_SPEED_MS}. Ends without landing when the mode leaves
 * the reposition mode, the selection changes, {@link LAND_REPOSITION_TIMEOUT_MS}
 * passes, or the operator cancels.
 */
export async function landAtPoint({
  protocol,
  droneId,
  lat,
  lon,
  alt,
  report,
}: LandAtPointArgs): Promise<void> {
  if (!protocol || !droneId) {
    report("No drone connected", "error");
    return;
  }
  const goto = await protocol.guidedGoto(lat, lon, alt);
  if (!goto.success) {
    report(`Land here failed — reposition rejected: ${goto.message}`, "error");
    return;
  }
  superviseGuidedTarget(
    { droneId, lat, lon, alt, timestamp: Date.now(), purpose: "land" },
    protocol,
    report,
  );
  report("Repositioning to land point", "info");
}
