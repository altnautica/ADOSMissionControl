"use client";

/**
 * @module cockpit/v2/LaunchSheet
 * @description The launch sequence: one hold-confirm that runs the
 * readiness checks, arms, takes off to the chosen altitude and then does the
 * after-takeoff action (hold, a skill, start the mission or go to a point),
 * with an optional "when done" action. The drone's pilot runs the sequence;
 * this sheet sends `launch` and shows the pilot's `sequence` as a step strip.
 * Pause at any point aborts to a hold (or disarms on the ground).
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { Rocket, X } from "lucide-react";

import { HoldButton } from "@/components/cockpit/v2/HoldButton";
import { pickerSkills } from "@/components/cockpit/v2/SkillPicker";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import { requestPilotAction, sendPilotAction } from "@/lib/input/pilot-stream";
import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useSkillRegistry } from "@/lib/skills";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export type LaunchAfter = "hold" | "skill" | "mission" | "goto";
export type LaunchWhenDone = "none" | "land" | "rth";

/** Default take-off altitude for a copter (m); a plane uses its TKOFF_ALT. */
export const LAUNCH_DEFAULT_ALT_M = 3;
/** The Launch hold (spec: 1.5 s). */
export const LAUNCH_HOLD_MS = 1500;

const STEPS = ["checks", "arm", "takeoff", "after", "done"] as const;
const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  checks: "Checks",
  arm: "Arm",
  takeoff: "Take off",
  after: "After take-off",
  done: "Done",
};

export interface LaunchArgs {
  after: LaunchAfter;
  alt_m?: number;
  skill?: { plugin_id: string; skill_id: string };
  goto?: { n: number; e: number; d: number };
  when_done?: "land" | "rth";
}

/** The `launch` action arguments for the sheet's choices. */
export function launchArgs(opts: {
  after: LaunchAfter;
  altM: number | null;
  skillId: string | null;
  gotoNE: [number, number];
  whenDone: LaunchWhenDone;
}): LaunchArgs {
  const args: LaunchArgs = { after: opts.after };
  if (opts.altM !== null) args.alt_m = opts.altM;
  if (opts.after === "skill" && opts.skillId) {
    const i = opts.skillId.indexOf(":");
    args.skill = { plugin_id: opts.skillId.slice(0, i), skill_id: opts.skillId.slice(i + 1) };
  }
  if (opts.after === "goto") {
    args.goto = { n: opts.gotoNE[0], e: opts.gotoNE[1], d: -(opts.altM ?? LAUNCH_DEFAULT_ALT_M) };
  }
  if (opts.whenDone !== "none") args.when_done = opts.whenDone;
  return args;
}

export function LaunchStepStrip({ sequence }: { sequence: PilotState["sequence"] }) {
  if (!sequence) return null;
  const at = STEPS.indexOf(sequence.step);
  return (
    <ol className="flex items-center gap-1" data-testid="launch-step-strip" data-step={sequence.step}>
      {STEPS.map((s, i) => (
        <li
          key={s}
          className={cn(
            "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
            sequence.error && i === at
              ? "bg-status-error/30 text-status-error"
              : i < at || sequence.step === "done"
                ? "bg-status-success/25 text-status-success"
                : i === at
                  ? "bg-accent-primary/30 text-accent-primary"
                  : "bg-white/5 text-text-tertiary",
          )}
        >
          {STEP_LABEL[s]}
        </li>
      ))}
      {sequence.error && <span className="ml-2 text-[11px] text-status-error">{sequence.error}</span>}
    </ol>
  );
}

interface LaunchSheetProps {
  droneId: string;
  pilot: PilotState | null;
  onClose: () => void;
}

export function LaunchSheet({ droneId, pilot, onClose }: LaunchSheetProps) {
  const tSkills = useTranslations("skills");
  const fixedWing = pilot?.vehicleClass === "fixedwing";
  const mission = useMissionStatus(droneId);
  const registry = useSkillRegistry((s) => s.skills);
  const behaviors = useMemo(
    () =>
      pickerSkills([...registry.values()], pilot?.vehicleClass ?? null).filter(
        (s) => s.motion === true && (s.pickerCategory ?? "behavior") === "behavior",
      ),
    [registry, pilot?.vehicleClass],
  );
  const [after, setAfter] = useState<LaunchAfter>("hold");
  const [alt, setAlt] = useState<number>(LAUNCH_DEFAULT_ALT_M);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [gotoNE, setGotoNE] = useState<[number, number]>([10, 0]);
  const [whenDone, setWhenDone] = useState<LaunchWhenDone>("none");
  const [sent, setSent] = useState<string | null>(null);

  const missionLoaded = mission?.state === "loaded";
  const ready = after !== "skill" || skillId !== null;
  const running = pilot?.sequence != null && pilot.sequence.step !== "done";

  const launch = () => {
    setSent("Launch sent");
    void requestPilotAction(
      "launch",
      launchArgs({ after, altM: fixedWing ? null : alt, skillId, gotoNE, whenDone }) as unknown as Record<string, unknown>,
    ).then((r) => setSent(r.ok ? "Launch accepted" : `Launch refused: ${r.err ?? "no reason given"}`));
  };

  const choice = (on: boolean) =>
    cn(
      "min-h-[40px] rounded px-3 text-xs font-semibold",
      on ? "bg-accent-primary/25 text-accent-primary" : "bg-white/5 text-text-secondary hover:bg-white/10",
    );

  return (
    <div
      role="dialog"
      aria-label="Launch"
      data-testid="launch-sheet"
      className="glass-panel pointer-events-auto absolute left-20 top-1/2 z-50 w-[min(380px,calc(100%-6rem))] -translate-y-1/2 p-4 text-text-primary"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Rocket size={15} aria-hidden="true" /> Launch
        </h2>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-white/10">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <label className="mb-3 block text-xs">
        <span className="mb-1 block text-text-secondary">Take-off altitude</span>
        {fixedWing ? (
          <span className="text-text-tertiary">The plane climbs to its TKOFF_ALT</span>
        ) : (
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={1.5}
              max={20}
              step={0.5}
              value={alt}
              onChange={(e) => setAlt(Number(e.target.value))}
              className="flex-1"
              aria-label="Take-off altitude"
            />
            <span className="w-12 text-right font-mono tabular-nums">{alt.toFixed(1)} m</span>
          </span>
        )}
      </label>

      <fieldset className="mb-3">
        <legend className="mb-1 text-xs text-text-secondary">After take-off</legend>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={choice(after === "hold")} onClick={() => setAfter("hold")}>
            Hold
          </button>
          <button
            type="button"
            className={choice(after === "skill")}
            onClick={() => setAfter("skill")}
            disabled={behaviors.length === 0}
            title={behaviors.length === 0 ? "No behaviour skill is installed" : undefined}
          >
            Skill
          </button>
          <button
            type="button"
            className={choice(after === "mission")}
            onClick={() => setAfter("mission")}
            disabled={!missionLoaded}
            title={missionLoaded ? undefined : "Upload a mission first"}
          >
            Start mission
          </button>
          <button type="button" className={choice(after === "goto")} onClick={() => setAfter("goto")}>
            Go to
          </button>
        </div>
        {after === "skill" && (
          <ul className="mt-2 flex flex-col gap-1" data-testid="launch-skill-list">
            {behaviors.map((s) => (
              <li key={s.id}>
                <button type="button" className={cn(choice(skillId === s.id), "w-full text-left")} onClick={() => setSkillId(s.id)}>
                  {skillDisplayLabel(s, tSkills)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {after === "goto" && (
          <div className="mt-2 flex gap-2 text-xs">
            {(["North", "East"] as const).map((axis, i) => (
              <label key={axis} className="flex flex-1 flex-col gap-1">
                <span className="text-text-secondary">{axis} of home (m)</span>
                <input
                  type="number"
                  value={gotoNE[i]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setGotoNE((p) => (i === 0 ? [v, p[1]] : [p[0], v]));
                  }}
                  className="rounded bg-white/10 px-2 py-1 font-mono"
                />
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="mb-4">
        <legend className="mb-1 text-xs text-text-secondary">When done</legend>
        <div className="flex gap-1">
          {(["none", "land", "rth"] as const).map((w) => (
            <button key={w} type="button" className={choice(whenDone === w)} onClick={() => setWhenDone(w)}>
              {w === "none" ? "Nothing" : w === "land" ? "Land" : "Return home"}
            </button>
          ))}
        </div>
      </fieldset>

      <LaunchStepStrip sequence={pilot?.sequence ?? null} />

      <div className="mt-3 flex items-center gap-2">
        {running ? (
          <button
            type="button"
            onClick={() => sendPilotAction("pause")}
            className="min-h-[48px] flex-1 rounded bg-status-error/25 text-sm font-semibold text-status-error"
          >
            Abort (Pause)
          </button>
        ) : (
          <HoldButton
            holdMs={LAUNCH_HOLD_MS}
            onFire={launch}
            disabled={!ready}
            title="Hold to launch"
            className="min-h-[48px] flex-1 rounded bg-accent-primary/25 text-sm font-semibold text-accent-primary"
          >
            Hold to launch
          </HoldButton>
        )}
      </div>
      {sent && <p className="mt-2 text-[11px] text-text-secondary">{sent}</p>}
    </div>
  );
}
