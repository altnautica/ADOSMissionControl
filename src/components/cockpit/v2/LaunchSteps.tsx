"use client";

/**
 * @module cockpit/v2/LaunchSteps
 * @description What a running launch shows and how it is stopped: the step
 * strip (checks, arm, take-off, after, done) drawn from the pilot's
 * `sequence`, the one Abort every launch surface shares (the Launch sheet,
 * the left column's running strip and the flight-state chip), and the strip
 * with its Abort as the left column shows it once the sheet is closed.
 *
 * Abort asks the pilot to pause, which holds the aircraft (or disarms it on
 * the ground). A refused or unanswered abort is never silent: it toasts
 * `flow.launch.abort_refused` with the pilot's reason.
 *
 * @license GPL-3.0-only
 */

import { useCallback } from "react";

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { refusalText } from "@/lib/hud/refusal";
import { specString } from "@/lib/cockpit/spec-strings";
import { requestPilotAction } from "@/lib/input/pilot-stream";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const STEPS = ["checks", "arm", "takeoff", "after", "done"] as const;
const STEP_KEY: Record<(typeof STEPS)[number], string> = {
  checks: "flow.launch.step.checks",
  arm: "flow.launch.step.arm",
  takeoff: "flow.launch.step.takeoff",
  after: "flow.launch.step.after_label",
  done: "flow.launch.step.done",
};

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

/**
 * The shared launch Abort. The returned function asks the pilot to pause and
 * resolves to the refusal text (already toasted) when the pilot refused or
 * did not answer, or null when it took the abort.
 */
export function useLaunchAbort(): () => Promise<string | null> {
  const { toast } = useToast();
  return useCallback(async () => {
    const r = await requestPilotAction("pause");
    if (r.ok) return null;
    const text = specString("flow.launch.abort_refused", { reason: refusalText(r.err) });
    toast(text, "error");
    return text;
  }, [toast]);
}

/** The running launch's step strip with its Abort, shown while the Launch
 *  sheet is closed. */
export function LaunchStepsRunning({ sequence }: { sequence: PilotState["sequence"] }) {
  const abort = useLaunchAbort();
  return (
    <div className="fs-sheet fs-launch-steps flex items-center gap-2" data-testid="launch-steps-running">
      <LaunchStepStrip sequence={sequence} />
      <button
        type="button"
        data-testid="launch-steps-abort"
        onClick={() => void abort()}
        className="fs-text-crit min-h-[40px] rounded bg-status-error/25 px-3 text-xs font-semibold"
      >
        {specString("flow.launch.abort")}
      </button>
    </div>
  );
}
