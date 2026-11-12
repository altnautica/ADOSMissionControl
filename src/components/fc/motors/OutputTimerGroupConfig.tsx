"use client";

import { useTranslations } from "next-intl";
import { TimerGroupDiagram } from "./TimerGroupDiagram";
import { AlertTriangle, Info } from "lucide-react";
import type { BoardProfile, TimerGroupConflict } from "@/lib/board-profiles";

export interface PwmWarning {
  output: number;
  message: string;
}

interface OutputTimerGroupConfigProps {
  hasLoaded: boolean;
  boardProfile: BoardProfile;
  functionMap: Map<number, number>;
  motPwmType: number;
  timerConflicts: TimerGroupConflict[];
  conflicts: string[];
  pwmWarnings: PwmWarning[];
  gpioOutputs: Set<number>;
  onBoardOverride: (profile: BoardProfile | null) => void;
}

export function OutputTimerGroupConfig({
  hasLoaded,
  boardProfile,
  functionMap,
  motPwmType,
  timerConflicts,
  conflicts,
  pwmWarnings,
  gpioOutputs,
  onBoardOverride,
}: OutputTimerGroupConfigProps) {
  const tr = useTranslations("fcPanels.outputTimerGroupConfig");
  return (
    <>
      {/* ── Timer Group Diagram ──────────────────────────── */}

      {hasLoaded && (
        <TimerGroupDiagram
          board={boardProfile}
          functions={functionMap}
          motPwmType={motPwmType}
          conflicts={timerConflicts}
          onBoardOverride={onBoardOverride}
        />
      )}

      {/* ── Timer Group Conflict Warning ────────────────── */}

      {timerConflicts.length > 0 && (
        <div className="p-2 bg-status-error/10 border border-status-error/20 space-y-1">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-status-error shrink-0" />
            <span className="text-[10px] font-medium text-status-error">{tr("timerGroupConflict")}</span>
          </div>
          {timerConflicts.map((c, i) => (
            <p key={i} className="text-[10px] text-status-error pl-5">
              Outputs {c.outputs.join(", ")} share a timer group.
              DShot motors ({c.dshotOutputs.map((o) => `S${o}`).join(", ")}) disable
              PWM servos ({c.pwmOutputs.map((o) => `S${o}`).join(", ")}).
              Move servos to an all-PWM group.
            </p>
          ))}
        </div>
      )}

      {/* ── Duplicate Functions ─────────────────────────── */}

      {conflicts.length > 0 && (
        <div className="p-2 bg-accent-primary/10 border border-accent-primary/20 space-y-1">
          <div className="flex items-center gap-1.5">
            <Info size={12} className="text-accent-primary shrink-0" />
            <span className="text-[10px] font-medium text-accent-primary">{tr("duplicateFunctions")}</span>
          </div>
          {conflicts.map((c, i) => (
            <p key={i} className="text-[10px] text-accent-primary pl-5">{c}</p>
          ))}
        </div>
      )}

      {/* ── PWM Warnings ───────────────────────────────── */}

      {pwmWarnings.length > 0 && (
        <div className="p-2 bg-status-warning/10 border border-status-warning/20 space-y-1">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-status-warning shrink-0" />
            <span className="text-[10px] font-medium text-status-warning">{tr("pwmWarnings")}</span>
          </div>
          {pwmWarnings.map((w, i) => (
            <p key={i} className="text-[10px] text-status-warning pl-5">Output {w.output}: {w.message}</p>
          ))}
        </div>
      )}

      {/* ── GPIO Info Banner ──────────────────────────────── */}

      {hasLoaded && gpioOutputs.size > 0 && (
        <div className="flex items-center gap-2 p-2 bg-accent-primary/10 border border-accent-primary/20">
          <Info size={12} className="text-accent-primary shrink-0" />
          <span className="text-[10px] text-text-secondary">
            {gpioOutputs.size} output{gpioOutputs.size > 1 ? "s" : ""} configured as GPIO
            (SERVO{[...gpioOutputs].join(", SERVO")}_FUNCTION = -1).
          </span>
        </div>
      )}
    </>
  );
}
