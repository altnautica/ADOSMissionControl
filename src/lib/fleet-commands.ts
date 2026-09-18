/**
 * Fleet-wide command fan-out.
 *
 * The one place a "do X to every active drone" control is implemented. Both
 * the command palette and the dashboard quick-action bar previously toasted an
 * affirmative for a fleet RTH they never issued; this module exists so a
 * fleet control either commands the vehicles or reports per-drone why it
 * could not.
 *
 * A drone with no resolvable protocol is a FAILURE, never a skip: the operator
 * asked for a fleet recall and one aircraft did not get it.
 */

import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";

export interface FleetCommandOutcome {
  /** Drones that acknowledged the command. */
  acknowledged: string[];
  /** `"<name>: <reason>"` per drone that did not. */
  failures: string[];
  /** Total drones the command was attempted against. */
  attempted: number;
}

/** Drones the fleet view considers airborne or armed. */
export function activeFleetDrones() {
  return useFleetStore
    .getState()
    .drones.filter(
      (d) => d.connectionState === "in_flight" || d.connectionState === "armed",
    );
}

/**
 * Command every active fleet drone to return to launch, one at a time, and
 * report each vehicle's own acknowledgement.
 */
export async function returnFleetToLaunch(): Promise<FleetCommandOutcome> {
  const targets = activeFleetDrones();
  const managed = useDroneManager.getState().drones;
  const acknowledged: string[] = [];
  const failures: string[] = [];

  for (const drone of targets) {
    const protocol = managed.get(drone.id)?.protocol;
    if (!protocol) {
      failures.push(`${drone.name}: no command link`);
      continue;
    }
    try {
      const result = await protocol.returnToLaunch();
      if (result.success) acknowledged.push(drone.name);
      else failures.push(`${drone.name}: ${result.message}`);
    } catch (err) {
      failures.push(
        `${drone.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { acknowledged, failures, attempted: targets.length };
}

/** Operator-facing summary of a fleet fan-out, with the toast severity. */
export function describeFleetOutcome(
  outcome: FleetCommandOutcome,
  verb: string,
): { message: string; variant: "success" | "error" } {
  if (outcome.failures.length === 0) {
    const n = outcome.acknowledged.length;
    return {
      message: `${verb} acknowledged by ${n} drone${n === 1 ? "" : "s"}`,
      variant: "success",
    };
  }
  return {
    message: `${verb} failed for ${outcome.failures.length} of ${outcome.attempted}: ${outcome.failures.join("; ")}`,
    variant: "error",
  };
}
