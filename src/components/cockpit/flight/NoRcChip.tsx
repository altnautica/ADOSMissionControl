"use client";

/**
 * @module cockpit/flight/NoRcChip
 * @description The top bar's "No RC" chip while the drone is declared to fly
 * with no RC transmitter (`pilot.rc_receiver == "absent"`); nothing
 * otherwise. Its title says what stops the drone and what a lost link ends in.
 * @license GPL-3.0-only
 */

import { specString } from "@/lib/cockpit/spec-strings";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { noRcStripText } from "@/lib/cockpit/no-rc-text";

export function NoRcChip({ droneId }: { droneId: string }) {
  const { pilot } = usePilotState(droneId);
  if (!pilot || pilot.rcReceiver !== "absent") return null;
  const text = specString("chip.no_rc");
  const posture = noRcStripText(pilot);
  return (
    <div className="stat" data-testid="no-rc-chip" title={posture} aria-label={posture}>
      <span className="v">{text}</span>
    </div>
  );
}
