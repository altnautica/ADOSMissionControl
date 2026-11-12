"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { BoardProfile, TimerGroupConflict } from "@/lib/board-profiles";
import { getOutputProtocol, UNKNOWN_BOARD, getBoardProfileListGrouped, getBoardProfileByName } from "@/lib/board-profiles";
import { getServoFunctionLabel } from "@/lib/servo-functions";
import { ChevronDown, ChevronRight, Cpu } from "lucide-react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface TimerGroupDiagramProps {
  board: BoardProfile;
  /** Map of output number (1-based) → SERVOx_FUNCTION value */
  functions: Map<number, number>;
  /** MOT_PWM_TYPE param value */
  motPwmType: number;
  /** Detected conflicts */
  conflicts: TimerGroupConflict[];
  /** Callback when user manually selects a board from the dropdown */
  onBoardOverride?: (board: BoardProfile) => void;
}

const PROTOCOL_COLORS: Record<string, string> = {
  DShot: "bg-status-error/20 border-status-error/40 text-status-error",
  PWM: "bg-accent-primary/20 border-accent-primary/40 text-accent-primary",
  Disabled: "bg-bg-tertiary border-border-default text-text-tertiary",
  GPIO: "bg-bg-tertiary border-border-default text-text-tertiary",
};

const PROTOCOL_DOT: Record<string, string> = {
  DShot: "bg-status-error",
  PWM: "bg-accent-primary",
  Disabled: "bg-text-tertiary/40",
  GPIO: "bg-text-tertiary/40",
};

/** Abbreviate long function labels to fit small boxes */
function abbreviate(label: string): string {
  if (label.length <= 8) return label;
  // Common abbreviations
  return label
    .replace("TiltMotorFront", "TiltF")
    .replace("TiltMotorsRear", "TiltR")
    .replace("TiltMotorRearLeft", "TiltRL")
    .replace("TiltMotorRearRight", "TiltRR")
    .replace("TiltMotorFrontLeft", "TiltFL")
    .replace("TiltMotorFrontRight", "TiltFR")
    .replace("DiffSpoilerLeft", "DSpoilL")
    .replace("DiffSpoilerRight", "DSpoilR")
    .replace("ElevonLeft", "ElevL")
    .replace("ElevonRight", "ElevR")
    .replace("VTailLeft", "VTailL")
    .replace("VTailRight", "VTailR")
    .replace("ThrottleLeft", "ThrtL")
    .replace("ThrottleRight", "ThrtR")
    .replace("FlaperonLeft", "FlapL")
    .replace("FlaperonRight", "FlapR")
    .replace("RCPassThru", "RCPass")
    .replace("GroundSteering", "GndStr")
    .replace("CameraTrigger", "CamTrig")
    .replace("EngineRunEnable", "EngRun")
    .replace("SprayerPump", "SpPump")
    .replace("SprayerSpinner", "SpSpin")
    .replace("LandingGear", "LndGear")
    .replace("Disabled", "—")
    .slice(0, 10);
}

export function TimerGroupDiagram({
  board,
  functions,
  motPwmType,
  conflicts,
  onBoardOverride,
}: TimerGroupDiagramProps) {
  const tr = useTranslations("fcPanels.timerGroupDiagram");
  const [expanded, setExpanded] = useState(true);
  const [selectedBoardName, setSelectedBoardName] = useState("");

  const boardGroups = useMemo(() => getBoardProfileListGrouped(), []);

  // Build set of conflicting outputs for quick lookup
  const conflictOutputs = useMemo(() => {
    const set = new Set<number>();
    for (const c of conflicts) {
      for (const o of c.disabledOutputs) set.add(o);
    }
    return set;
  }, [conflicts]);

  const conflictGroups = useMemo(
    () => new Set(conflicts.map((c) => c.groupIndex)),
    [conflicts],
  );

  if (board === UNKNOWN_BOARD || board.timerGroups.length === 0) {
    return (
      <div className="p-2 bg-bg-secondary border border-border-default">
        <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
          <Cpu size={10} />
          <span>Board not identified — select manually:</span>
          <Select
            value={selectedBoardName}
            onChange={(v) => {
              setSelectedBoardName(v);
              if (v && onBoardOverride) {
                onBoardOverride(getBoardProfileByName(v));
              }
            }}
            placeholder={tr("selectBoard")}
            searchable
            options={boardGroups}
            className="text-[10px]"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border-default bg-bg-secondary">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary/50 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Cpu size={12} className="text-text-secondary" />
        <span className="text-[11px] font-medium text-text-primary">
          {tr("timerGroupLayout")}
        </span>
        <span className="text-[10px] text-text-tertiary">
          {board.name} — {board.outputCount} outputs, {board.timerGroups.length} groups
        </span>
        {conflicts.length > 0 && (
          <span className="ml-auto text-[10px] font-medium text-status-error">
            {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""}
          </span>
        )}
      </button>

      {/* Diagram */}
      <div className={cn(
        "grid transition-all duration-200 ease-in-out",
        expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}>
        <div className="overflow-hidden px-3 pb-3">
          <div className="flex flex-wrap gap-2">
            {board.timerGroups.map((group, gi) => {
              const hasConflict = conflictGroups.has(gi);
              return (
                <div
                  key={gi}
                  className={`flex flex-col border ${
                    hasConflict
                      ? "border-status-error/50 bg-status-error/5"
                      : "border-border-default bg-bg-tertiary/30"
                  }`}
                >
                  {/* Group header */}
                  <div className={`px-2 py-1 text-[9px] font-medium border-b ${
                    hasConflict
                      ? "border-status-error/30 text-status-error"
                      : "border-border-default text-text-tertiary"
                  }`}>
                    Group {gi + 1}
                    {hasConflict && " — CONFLICT"}
                  </div>

                  {/* Output cells */}
                  <div className="flex">
                    {group.map((output) => {
                      const fn = functions.get(output) ?? 0;
                      const proto = getOutputProtocol(fn, motPwmType);
                      const isConflict = conflictOutputs.has(output);
                      const note = board.outputNotes[output];
                      const label = fn === 0 ? "—" : abbreviate(getServoFunctionLabel(fn));

                      return (
                        <div
                          key={output}
                          className={`flex flex-col items-center p-1.5 min-w-[52px] border-r last:border-r-0 ${
                            isConflict
                              ? "border-status-error/30"
                              : "border-border-default/50"
                          }`}
                          title={`Output ${output}: ${getServoFunctionLabel(fn)} (${proto})${note ? ` — ${note}` : ""}`}
                        >
                          {/* Output number */}
                          <span className={`text-[9px] font-mono ${
                            isConflict ? "text-status-error font-bold" : "text-text-tertiary"
                          }`}>
                            S{output}
                          </span>

                          {/* Protocol dot */}
                          <div className={`w-2 h-2 rounded-full my-0.5 ${PROTOCOL_DOT[proto]}`} />

                          {/* Function label */}
                          <span className={`text-[8px] leading-tight text-center ${
                            isConflict ? "text-status-error" : "text-text-secondary"
                          }`}>
                            {label}
                          </span>

                          {/* Protocol badge */}
                          <span className={`mt-0.5 text-[7px] px-1 py-px border ${PROTOCOL_COLORS[proto]}`}>
                            {proto}
                          </span>

                          {/* Solder pad indicator */}
                          {note && (
                            <span className="text-[7px] text-text-tertiary mt-0.5" title={note}>
                              pad
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-2 text-[9px] text-text-tertiary">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-error" />
              {tr("dshotMotor")}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
              {tr("pwmServo")}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary/40" />
              {tr("disabledGPIO")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
