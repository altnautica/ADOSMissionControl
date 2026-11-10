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

import { useMemo, useRef, useState } from "react";
import { useLaunchRequestStore } from "@/stores/launch-request-store";
import { Rocket, X } from "lucide-react";

import { HoldButton } from "@/components/cockpit/v2/HoldButton";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { FlightSheetPortal, sheetPlacement, useSheetDismiss } from "@/components/cockpit/flight/flight-sheet";
import { pickerSkills } from "@/components/cockpit/v2/SkillPicker";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import { refusalText } from "@/lib/hud/refusal";
import { launchLimits } from "@/lib/cockpit/launch-spec";
import { specBuiltin } from "@/lib/cockpit/spec-builtins";
import { specString } from "@/lib/cockpit/spec-strings";
import { requestPilotAction } from "@/lib/input/pilot-stream";
import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useSkillRegistry } from "@/lib/skills";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export type LaunchAfter = "hold" | "skill" | "mission" | "goto";
export type LaunchWhenDone = "none" | "land" | "rth";

/** Default take-off altitude for a copter (m, spec `launch.alt_default_m`);
 * a plane uses its TKOFF_ALT. */
export const LAUNCH_DEFAULT_ALT_M = launchLimits.altDefaultM;
/** The Launch hold: the take-off built-in's confirm hold. */
export const LAUNCH_HOLD_MS = specBuiltin("takeoff").confirm.ms ?? 1500;

const STEPS = ["checks", "arm", "takeoff", "after", "done"] as const;
const STEP_KEY: Record<(typeof STEPS)[number], string> = {
  checks: "flow.launch.step.checks",
  arm: "flow.launch.step.arm",
  takeoff: "flow.launch.step.takeoff",
  after: "flow.launch.step.after_label",
  done: "flow.launch.step.done",
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
              ? "bg-status-error/30 fs-text-crit"
              : i < at || sequence.step === "done"
                ? "bg-status-success/25 text-status-success"
                : i === at
                  ? "bg-accent-primary/30 text-accent-primary"
                  : "bg-white/5 text-text-tertiary",
          )}
        >
          {specString(STEP_KEY[s])}
        </li>
      ))}
      {sequence.error && <span className="fs-text-crit ml-2 text-[11px]">{refusalText(sequence.error)}</span>}
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
  // A point picked on a map ("Launch here") prefills the go-to once; with
  // none, there is no default go-to offset and the operator enters the point.
  const [picked] = useState(() => {
    const req = useLaunchRequestStore.getState().pending;
    if (req?.droneId !== droneId || req.north === undefined || req.east === undefined) return null;
    useLaunchRequestStore.getState().consume();
    return [Math.round(req.north * 10) / 10, Math.round(req.east * 10) / 10] as [number, number];
  });
  const [after, setAfter] = useState<LaunchAfter>(picked ? "goto" : "hold");
  const [alt, setAlt] = useState<number>(LAUNCH_DEFAULT_ALT_M);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [gotoNE, setGotoNE] = useState<[number | null, number | null]>(picked ?? [null, null]);
  const [whenDone, setWhenDone] = useState<LaunchWhenDone>("none");
  const [sent, setSent] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useSheetDismiss(ref, onClose, "[data-sheet-trigger='launch']");
  // At the flight screen's root, right of the left column, below the top bar.
  const place = sheetPlacement(useFlightGrid(), "left");

  const missionLoaded = mission?.state === "loaded";
  const gotoSet = gotoNE[0] !== null && gotoNE[1] !== null;
  const ready = (after !== "skill" || skillId !== null) && (after !== "goto" || gotoSet);
  const running = pilot?.sequence != null && pilot.sequence.step !== "done";

  const launch = () => {
    setSent(specString("flow.launch.sent"));
    void requestPilotAction(
      "launch",
      launchArgs({
        after,
        altM: fixedWing ? null : alt,
        skillId,
        gotoNE: [gotoNE[0] ?? 0, gotoNE[1] ?? 0],
        whenDone,
      }) as unknown as Record<string, unknown>,
    ).then((r) =>
      setSent(r.ok ? specString("flow.launch.accepted") : specString("flow.launch.refused", { reason: refusalText(r.err) })),
    );
  };
  const abort = () =>
    void requestPilotAction("pause").then((r) =>
      setSent(r.ok ? null : specString("flow.launch.abort_refused", { reason: refusalText(r.err) })),
    );

  const choice = (on: boolean) =>
    cn(
      "min-h-[40px] rounded px-3 text-xs font-semibold",
      on ? "bg-accent-primary/25 text-accent-primary" : "bg-white/5 text-text-secondary hover:bg-white/10",
    );

  return (
    <FlightSheetPortal>
    <div
      ref={ref}
      role="dialog"
      aria-label={specString("flow.launch.title")}
      data-testid="launch-sheet"
      style={place}
      className="glass-panel pointer-events-auto absolute z-50 max-h-[calc(100%-var(--fs-bar-b)-16px)] w-[min(380px,calc(100%-16px))] overflow-y-auto p-4 text-text-primary"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Rocket size={15} aria-hidden="true" /> {specString("flow.launch.title")}
        </h2>
        <button type="button" aria-label={specString("cockpit.close")} onClick={onClose} className="rounded p-1 hover:bg-white/10">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <label className="mb-3 block text-xs">
        <span className="mb-1 block text-text-secondary">{specString("flow.launch.alt_m")}</span>
        {fixedWing ? (
          <span className="text-text-tertiary">{specString("flow.launch.plane_alt")}</span>
        ) : (
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={launchLimits.altMinM}
              max={launchLimits.altMaxM}
              step={0.5}
              value={alt}
              onChange={(e) => setAlt(Number(e.target.value))}
              className="flex-1"
              aria-label={specString("flow.launch.alt_m")}
            />
            <span className="w-14 text-right font-mono tabular-nums">{alt.toFixed(1)} m</span>
          </span>
        )}
      </label>

      <fieldset className="mb-3">
        <legend className="mb-1 text-xs text-text-secondary">{specString("flow.launch.after")}</legend>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={choice(after === "hold")} onClick={() => setAfter("hold")}>
            {specString("flow.launch.after.hold")}
          </button>
          <button
            type="button"
            className={choice(after === "skill")}
            onClick={() => setAfter("skill")}
            disabled={behaviors.length === 0}
            title={behaviors.length === 0 ? specString("flow.launch.after.skill_none") : undefined}
          >
            {specString("flow.launch.after.skill")}
          </button>
          <button
            type="button"
            className={choice(after === "mission")}
            onClick={() => setAfter("mission")}
            disabled={!missionLoaded}
            title={missionLoaded ? undefined : specString("flow.launch.after.mission_none")}
          >
            {specString("flow.launch.after.mission")}
          </button>
          <button type="button" className={choice(after === "goto")} onClick={() => setAfter("goto")}>
            {specString("flow.launch.after.goto")}
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
            {(["flow.launch.goto.north", "flow.launch.goto.east"] as const).map((key, i) => (
              <label key={key} className="flex flex-1 flex-col gap-1">
                <span className="text-text-secondary">{specString(key)} (m)</span>
                <input
                  type="number"
                  value={gotoNE[i] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
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
        <legend className="mb-1 text-xs text-text-secondary">{specString("flow.launch.when_done")}</legend>
        <div className="flex gap-1">
          {(["none", "land", "rth"] as const).map((w) => (
            <button key={w} type="button" className={choice(whenDone === w)} onClick={() => setWhenDone(w)}>
              {specString(`flow.launch.when_done.${w}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <LaunchStepStrip sequence={pilot?.sequence ?? null} />

      <div className="mt-3 flex items-center gap-2">
        {running ? (
          <button
            type="button"
            data-testid="launch-abort"
            onClick={abort}
            className="fs-text-crit min-h-[48px] flex-1 rounded bg-status-error/25 text-sm font-semibold"
          >
            {specString("flow.launch.abort")}
          </button>
        ) : (
          <HoldButton
            holdMs={LAUNCH_HOLD_MS}
            onFire={launch}
            disabled={!ready}
            title={specString("flow.launch.hold_aria")}
            className="min-h-[48px] flex-1 rounded bg-accent-primary/25 text-sm font-semibold text-accent-primary"
          >
            {specString("flow.launch.hold_to_launch")}
          </HoldButton>
        )}
      </div>
      {sent && <p className="mt-2 text-[11px] text-text-secondary">{sent}</p>}
    </div>
    </FlightSheetPortal>
  );
}
