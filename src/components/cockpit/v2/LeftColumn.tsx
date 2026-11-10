"use client";

/**
 * The left column, vertically centred in its grid zone: Take off / Land,
 * Return home and Pause, 56 px targets (48 px at compact). In portrait it is
 * a row under the video. Each fires its built-in through the shared skill
 * pipeline, so the spec's confirm tier and gates apply.
 *
 * @module cockpit/v2/LeftColumn
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Home, Pause } from "lucide-react";

import { LaunchSheet, LaunchStepStrip } from "@/components/cockpit/v2/LaunchSheet";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { pilotStreamOpen, requestPilotAction, usePilotLinkStore } from "@/lib/input/pilot-stream";
import { specBuiltin } from "@/lib/cockpit/spec-builtins";
import { specString } from "@/lib/cockpit/spec-strings";
import { activate, buildSkillContext } from "@/lib/skills";
import { useDroneStore } from "@/stores/drone-store";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { rectStyle } from "@/components/cockpit/flight/flight-grid";
import { useFlightSheet } from "@/components/cockpit/flight/flight-sheet";
import { useLaunchRequestStore } from "@/stores/launch-request-store";

export function LeftColumn({ droneId }: { droneId: string }) {
  const armState = useDroneStore((s) => s.armState);
  const { pilot } = usePilotState(droneId);
  const onGround = armState !== "armed" || pilot?.landed === true;
  const fire = (id: string) => void activate(id, buildSkillContext(droneId));
  // With the drone's pilot reachable, Take off opens the Launch sheet (one
  // hold runs checks, arm, take-off and the after-take-off action); without
  // it, Take off is the plain built-in.
  usePilotLinkStore((s) => s.connected);
  const viaPilot = pilotStreamOpen(droneId) && pilot !== null;
  const [launchOpen, setLaunchOpen] = useFlightSheet("launch");
  // The Launch sheet is a ground sheet: it closes once the drone is flying.
  useEffect(() => {
    if (!onGround) setLaunchOpen(false);
  }, [onGround, setLaunchOpen]);
  // "Launch here" on a map: open the sheet, which takes the point. A request
  // the sheet cannot use (flying, or no pilot) is dropped.
  const launchRequested = useLaunchRequestStore((s) => s.pending?.droneId === droneId);
  useEffect(() => {
    if (!launchRequested) return;
    if (onGround && viaPilot) setLaunchOpen(true);
    else useLaunchRequestStore.getState().consume();
  }, [launchRequested, onGround, viaPilot, setLaunchOpen]);
  const sequence = pilot?.sequence ?? null;
  const sequenceRunning = sequence !== null && sequence.step !== "done";
  const grid = useFlightGrid();
  const rect = grid.zones.left_column;
  if (!rect) return null;
  const row = grid.cls === "portrait";

  const btn = "fs-btn fs-col-target";

  return (
    <div
      className={`fs-col fs-col-left${row ? " fs-col-row" : ""}`}
      data-zone="left_column"
      data-testid="left-column"
      style={{ ...rectStyle(rect), "--fs-target": `${grid.target}px` } as React.CSSProperties}
    >
      <div className="fs-col-stack">
      {onGround ? (
        <button
          type="button"
          className={btn}
          data-sheet-trigger="launch"
          onClick={() => (viaPilot ? setLaunchOpen((o) => !o) : fire("takeoff"))}
          aria-label={specBuiltin("takeoff").label}
          aria-expanded={viaPilot ? launchOpen : undefined}
        >
          <ArrowUpFromLine size={18} aria-hidden />
          Take off
        </button>
      ) : (
        <button type="button" className={btn} onClick={() => fire("land")} aria-label={specBuiltin("land").label}>
          <ArrowDownToLine size={18} aria-hidden />
          Land
        </button>
      )}
      <button type="button" className={btn} onClick={() => fire("rth")} aria-label={specBuiltin("rth").label}>
        <Home size={18} aria-hidden />
        RTH
      </button>
      <button type="button" className={btn} onClick={() => fire("pause")} aria-label={specBuiltin("pause").label}>
        <Pause size={18} aria-hidden />
        Pause
      </button>
      </div>
      {launchOpen && viaPilot && (
        <LaunchSheet droneId={droneId} pilot={pilot} onClose={() => setLaunchOpen(false)} />
      )}
      {!launchOpen && sequenceRunning && (
        <div className="fs-sheet fs-launch-steps flex items-center gap-2" data-testid="launch-steps-running">
          <LaunchStepStrip sequence={sequence} />
          <button
            type="button"
            data-testid="launch-steps-abort"
            onClick={() => void requestPilotAction("pause")}
            className="min-h-[40px] rounded bg-status-error/25 px-3 text-xs font-semibold text-status-error"
          >
            {specString("flow.launch.abort")}
          </button>
        </div>
      )}
    </div>
  );
}
