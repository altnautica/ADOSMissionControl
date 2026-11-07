"use client";

/**
 * The left column, vertically centred: Take off / Land, Return home
 * and Pause, 56 px targets. Each fires its built-in through the shared skill
 * pipeline, so the spec's confirm tier and gates apply.
 *
 * @module cockpit/v2/LeftColumn
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Home, Pause } from "lucide-react";

import { LaunchSheet, LaunchStepStrip } from "@/components/cockpit/v2/LaunchSheet";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { pilotStreamOpen, usePilotLinkStore } from "@/lib/input/pilot-stream";
import { activate, buildSkillContext } from "@/lib/skills";
import { useDroneStore } from "@/stores/drone-store";

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
  const [launchOpen, setLaunchOpen] = useState(false);
  const sequence = pilot?.sequence ?? null;
  const sequenceRunning = sequence !== null && sequence.step !== "done";

  const btn =
    "glass-pill flex h-14 w-14 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-text-primary";

  return (
    <div
      className="pointer-events-auto absolute left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-3"
      data-testid="left-column"
    >
      {onGround ? (
        <button
          type="button"
          className={btn}
          onClick={() => (viaPilot ? setLaunchOpen((o) => !o) : fire("takeoff"))}
          aria-label="Take off"
          aria-expanded={viaPilot ? launchOpen : undefined}
        >
          <ArrowUpFromLine size={18} aria-hidden />
          Take off
        </button>
      ) : (
        <button type="button" className={btn} onClick={() => fire("land")} aria-label="Land">
          <ArrowDownToLine size={18} aria-hidden />
          Land
        </button>
      )}
      <button type="button" className={btn} onClick={() => fire("rth")} aria-label="Return home">
        <Home size={18} aria-hidden />
        RTH
      </button>
      <button type="button" className={btn} onClick={() => fire("pause")} aria-label="Pause">
        <Pause size={18} aria-hidden />
        Pause
      </button>
      {launchOpen && viaPilot && (
        <LaunchSheet droneId={droneId} pilot={pilot} onClose={() => setLaunchOpen(false)} />
      )}
      {!launchOpen && sequenceRunning && (
        <div className="glass-panel absolute left-20 top-0 p-2">
          <LaunchStepStrip sequence={sequence} />
        </div>
      )}
    </div>
  );
}
