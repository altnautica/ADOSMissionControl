"use client";

/**
 * @module fc/calibration/AgentSetupStep
 * @description A calibration or tuning panel for a drone whose agent runs the
 * setup engine. Its run button starts that one engine step
 * (`POST /api/v1/fc-setup/{wizard}/steps/{step}/run`) instead of sending
 * MAVLink, and the step then renders from the setup stream like it does in the
 * aircraft setup wizard. With no agent setup engine (a direct-serial FC, an
 * agent without the engine, or a step this FC's wizard does not have) it
 * renders `children`, the panel's own MAVLink path, unchanged.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { Cpu, Play } from "lucide-react";

import { StepCard } from "@/components/aircraft-setup/StepCard";
import { Button } from "@/components/ui/button";
import { specString } from "@/lib/cockpit/spec-strings";
import { findStep, type FcSetupController } from "@/lib/fc-setup/use-fc-setup";

export function AgentSetupStep({
  setup,
  wizard,
  step,
  children,
}: {
  /** The drone's agent setup controller; null keeps the MAVLink panel. */
  setup: FcSetupController | null;
  wizard: "ground" | "air";
  step: string;
  children: ReactNode;
}) {
  const current = setup ? findStep(setup.status, wizard, step) : null;
  if (!setup || !current) return <>{children}</>;

  // Running or waiting on the operator: the engine drives the step and its own actions show.
  const active = current.state === "running" || current.state === "waiting_user";
  const runKey = `${wizard}/${step}/run`;
  const runLabel = specString(current.state === "pending" ? "setup.action.start" : "setup.action.run_again");

  return (
    <div className="space-y-2" data-testid={`agent-setup-${wizard}-${step}`} data-agent-routed="true">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-tertiary">
        <Cpu size={12} aria-hidden />
        <span>{specString("setup.wizard.entry.settings")}</span>
      </div>
      <StepCard
        step={current}
        busy={setup.busy !== null}
        error={setup.requestError}
        onAction={(s, id, args) => void setup.action(s, id, args)}
      />
      {!active && (
        <Button
          variant="primary"
          size="sm"
          icon={<Play size={12} />}
          loading={setup.busy === runKey}
          disabled={setup.busy !== null}
          onClick={() => void setup.runStep(wizard, step)}
          data-testid={`agent-setup-run-${step}`}
        >
          {runLabel}
        </Button>
      )}
    </div>
  );
}
