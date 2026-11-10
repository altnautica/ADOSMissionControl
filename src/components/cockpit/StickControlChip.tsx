"use client";

/**
 * The stick-control row: where the gamepad's sticks go, and who holds
 * pilot-in-command on the ground station when a claim exists.
 *
 * With the drone's pilot in `ados` control the pad streams to ADOS Pilot
 * whatever the RC-override switch says, so the row names that route with the
 * pilot's live input session and shows no switch. In `fc_manual` (or with no
 * pilot reporting) the sticks reach the flight controller through the RC
 * override, and the row is that route's switch: the same input-store opt-in
 * the input settings page owns, off at every start, needs a connected gamepad
 * and a live session for this drone, and is revoked by the store when the pad
 * drops. In `elrs` the ground station's radio drives the FC.
 *
 * @license GPL-3.0-only
 */

import { Gamepad2 } from "lucide-react";
import flightStateSpec from "@/lib/cockpit-spec/flight-state.json";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { specString } from "@/lib/cockpit/spec-strings";
import { useInputStore } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useGroundStationStore } from "@/stores/ground-station-store";

const CONTROL = flightStateSpec.mode_sheet.control_mode;

export function StickControlChip({ droneId }: { droneId: string }) {
  const hasGamepad = useInputStore((s) => s.activeController === "gamepad");
  const enabled = useInputStore((s) => s.manualControlEnabled);
  const setEnabled = useInputStore((s) => s.setManualControlEnabled);
  const linkBlock = useInputStore((s) => s.manualControlLinkBlock);
  const hasSession = useDroneManager((s) => s.drones.has(droneId));
  const picHolder = useGroundStationStore((s) => s.pic.claimed_by);
  const { pilot } = usePilotState(droneId);
  const mode = pilot?.controlMode ?? null;

  const pic = picHolder && (
    <span className="k keep" title={specString("cockpit.pic_title", { holder: picHolder })}>
      {specString("cockpit.pic", { holder: picHolder })}
    </span>
  );

  // ADOS Pilot (or the ground station's radio) has the sticks: name the
  // route; the FC RC-override switch does not apply.
  if (mode === "ados" || mode === "elrs") {
    const label = CONTROL.labels[CONTROL.values.indexOf(mode)];
    const live = mode === "ados" && pilot?.inputSrc;
    return (
      <div className="stat" data-testid="cockpit-stick" data-route={mode}>
        <span
          className="flex items-center gap-1.5 px-1 py-0.5"
          style={{ color: live ? "var(--hud-good)" : "var(--hud-ink-2)" }}
        >
          <Gamepad2 size={13} aria-hidden="true" />
          <span className="k" style={{ color: "inherit" }}>
            {specString("flow.sticks_with", { label })}
          </span>
          {mode === "ados" && (
            <span className="v" style={{ color: "inherit", fontSize: 11 }}>
              {pilot?.inputSrc ?? specString("controls.no_controller")}
            </span>
          )}
        </span>
        {pic}
      </div>
    );
  }

  const available = hasGamepad && hasSession;
  const blocked = enabled && linkBlock !== null;
  const color = blocked ? "var(--hud-warn)" : enabled ? "var(--hud-good)" : "var(--hud-ink-2)";
  const title = !hasGamepad
    ? specString("cockpit.sticks.no_gamepad")
    : !hasSession
      ? specString("cockpit.sticks.no_session")
      : blocked
        ? linkBlock
        : enabled
          ? specString("cockpit.sticks.disable")
          : specString("cockpit.sticks.enable");

  return (
    <div className="stat" data-testid="cockpit-stick" data-route="fc">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={specString("cockpit.sticks.to_fc")}
        title={title}
        disabled={!available && !enabled}
        onClick={() => setEnabled(!enabled)}
        className="pointer-events-auto flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50"
        style={{ color, background: "none", border: 0, cursor: available ? "pointer" : undefined }}
      >
        <Gamepad2 size={13} aria-hidden="true" />
        <span className="k" style={{ color: "inherit" }}>
          {specString("cockpit.sticks.to_fc")}
        </span>
        <span className="v" style={{ color: "inherit", fontSize: 11 }}>
          {specString(blocked ? "skill.avoid.blocked" : enabled ? "cockpit.sticks.state_on" : "cockpit.sticks.state_off")}
        </span>
      </button>
      {pic}
    </div>
  );
}
