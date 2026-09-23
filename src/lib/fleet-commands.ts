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

/**
 * Command every fleet drone that is airborne or armed on a live FC link to
 * return to launch, one at a time, and report each vehicle's own
 * acknowledgement. A drone whose FC link is lost has an unknown arm state: it
 * is reported as a failure without a send, because nothing would acknowledge
 * it and the operator has to know that aircraft was not recalled.
 */
export async function returnFleetToLaunch(): Promise<FleetCommandOutcome> {
  const fleet = useFleetStore.getState().drones;
  const targets = fleet.filter(
    (d) => d.connectionState === "in_flight" || d.connectionState === "armed",
  );
  const managed = useDroneManager.getState().drones;
  const acknowledged: string[] = [];
  const failures: string[] = [];
  let attempted = targets.length;

  for (const drone of fleet) {
    if (drone.fcLinkLost !== true) continue;
    failures.push(`${drone.name}: FC link lost, arm state unknown`);
    attempted++;
  }

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

  return { acknowledged, failures, attempted };
}

/**
 * Operator-facing summary of a fleet fan-out, with the toast severity. An
 * outcome that attempted nothing is a warning, never an affirmative.
 */
export function describeFleetOutcome(
  outcome: FleetCommandOutcome,
  verb: string,
): { message: string; variant: "success" | "warning" | "error" } {
  if (outcome.attempted === 0) {
    return { message: `No active drones for ${verb}`, variant: "warning" };
  }
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
