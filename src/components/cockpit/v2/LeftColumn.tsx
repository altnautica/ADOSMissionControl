"use client";

/**
 * The DJI-grid left column, vertically centred: Take off / Land, Return home
 * and Pause, 56 px targets. Each fires its built-in through the shared skill
 * pipeline, so the spec's confirm tier and gates apply.
 *
 * @module cockpit/v2/LeftColumn
 * @license GPL-3.0-only
 */

import { ArrowDownToLine, ArrowUpFromLine, Home, Pause } from "lucide-react";

import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { activate, buildSkillContext } from "@/lib/skills";
import { useDroneStore } from "@/stores/drone-store";

export function LeftColumn({ droneId }: { droneId: string }) {
  const armState = useDroneStore((s) => s.armState);
  const { pilot } = usePilotState(droneId);
  const onGround = armState !== "armed" || pilot?.landed === true;
  const fire = (id: string) => void activate(id, buildSkillContext(droneId));

  const btn =
    "glass-pill flex h-14 w-14 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-text-primary";

  return (
    <div
      className="pointer-events-auto absolute left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-3"
      data-testid="left-column"
    >
      {onGround ? (
        <button type="button" className={btn} onClick={() => fire("takeoff")} aria-label="Take off">
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
    </div>
  );
}
