"use client";

import { Card } from "@/components/ui/card";
import { Select, type SelectOptionGroup } from "@/components/ui/select";
import { SERVO_FUNCTION_GROUPS } from "@/lib/servo-functions";
import {
  getTimerGroupForOutput,
  type BoardProfile,
} from "@/lib/board-profiles";

export interface OutputRow {
  function: number;
  min: number;
  max: number;
  trim: number;
  reversed: boolean;
}

const PWM_ABS_MIN = 800;
const PWM_ABS_MAX = 2200;

const SERVO_FUNCTION_SELECT_GROUPS: SelectOptionGroup[] = SERVO_FUNCTION_GROUPS.map((group) => ({
  label: group.label,
  options: group.functions.map((fn) => ({
    value: String(fn.value),
    label: `${fn.value} — ${fn.label}`,
  })),
}));

interface ServoMappingTableProps {
  /** One entry per output, null where the output's parameters were not read. */
  outputs: (OutputRow | null)[];
  gpioOutputs: Set<number>;
  conflictDisabledOutputs: Set<number>;
  boardProfile: BoardProfile;
  liveServos: number[];
  setLocalValue: (name: string, value: number) => void;
}

export function ServoMappingTable({
  outputs,
  gpioOutputs,
  conflictDisabledOutputs,
  boardProfile,
  liveServos,
  setLocalValue,
}: ServoMappingTableProps) {
  return (
    <Card padding={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default text-text-secondary">
              <th className="px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Function</th>
              <th className="px-3 py-2 text-left font-medium">Min</th>
              <th className="px-3 py-2 text-left font-medium">Max</th>
              <th className="px-3 py-2 text-left font-medium">Trim</th>
              <th className="px-3 py-2 text-left font-medium">Rev</th>
              <th className="px-3 py-2 text-left font-medium">Current</th>
            </tr>
          </thead>
          <tbody>
            {outputs.map((row, i) => {
              const n = i + 1;
              if (row === null) {
                return (
                  <tr key={i} className="border-b border-border-default last:border-0">
                    <td className="px-3 py-1.5 font-mono text-text-secondary">{n}</td>
                    <td colSpan={6} className="px-3 py-1.5 text-[10px] text-text-tertiary">
                      — not read from the FC
                    </td>
                  </tr>
                );
              }
              const hasDuplicateFn = row.function > 0 && outputs.some(
                (other, j) => j !== i && other !== null && other.function === row.function
              );
              const isGpio = gpioOutputs.has(n);
              const isTimerConflict = conflictDisabledOutputs.has(n);
              const timerGroup = boardProfile.timerGroups.length > 0
                ? getTimerGroupForOutput(boardProfile, n)
                : -1;
              const livePwm = liveServos[i];
              const hasLivePwm = livePwm !== undefined && livePwm > 0;
              return (
                <tr
                  key={i}
                  className={`border-b border-border-default last:border-0 hover:bg-bg-tertiary/50 ${
                    isTimerConflict ? "bg-status-error/10" : hasDuplicateFn ? "bg-status-error/5" : ""
                  } ${isGpio ? "opacity-40" : ""}`}
                >
                  <td className="px-3 py-1.5 font-mono text-text-secondary">
                    <span className="flex items-center gap-1">
                      {n}
                      {timerGroup >= 0 && (
                        <span className="text-[7px] font-sans text-text-tertiary bg-bg-tertiary px-0.5 py-px" title={`Timer Group ${timerGroup + 1}`}>
                          G{timerGroup + 1}
                        </span>
                      )}
                      {isGpio && (
                        <span className="text-[8px] font-sans text-text-tertiary bg-bg-tertiary px-1 py-px">
                          GPIO
                        </span>
                      )}
                      {isTimerConflict && (
                        <span className="text-[7px] font-sans text-status-error bg-status-error/10 px-0.5 py-px" title="Disabled by timer group conflict">
                          CONFLICT
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <Select
                      options={SERVO_FUNCTION_SELECT_GROUPS}
                      value={String(row.function)}
                      onChange={(v) => setLocalValue(`SERVO${n}_FUNCTION`, Number(v))}
                      searchable={true}
                      searchPlaceholder="Search functions..."
                      className={
                        isTimerConflict || hasDuplicateFn ? "border-status-error" : ""
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      value={row.min}
                      onChange={(e) => setLocalValue(`SERVO${n}_MIN`, Number(e.target.value))}
                      className={`w-16 h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary ${
                        row.min < PWM_ABS_MIN || row.min > PWM_ABS_MAX || row.min >= row.max
                          ? "border-status-warning"
                          : "border-border-default"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      value={row.max}
                      onChange={(e) => setLocalValue(`SERVO${n}_MAX`, Number(e.target.value))}
                      className={`w-16 h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary ${
                        row.max < PWM_ABS_MIN || row.max > PWM_ABS_MAX || row.min >= row.max
                          ? "border-status-warning"
                          : "border-border-default"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      value={row.trim}
                      onChange={(e) => setLocalValue(`SERVO${n}_TRIM`, Number(e.target.value))}
                      className={`w-16 h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary ${
                        row.trim < row.min || row.trim > row.max
                          ? "border-status-warning"
                          : "border-border-default"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => setLocalValue(`SERVO${n}_REVERSED`, row.reversed ? 0 : 1)}
                      className={`w-7 h-7 border text-[10px] font-mono transition-colors ${
                        row.reversed
                          ? "bg-accent-primary border-accent-primary text-accent-foreground"
                          : "bg-bg-tertiary border-border-default text-text-tertiary"
                      }`}
                    >
                      {row.reversed ? "R" : "—"}
                    </button>
                  </td>
                  <td className="px-3 py-1.5">
                    {hasLivePwm ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-3 bg-bg-tertiary border border-border-default relative overflow-hidden">
                          <div
                            className="h-full bg-status-success/60"
                            style={{ width: `${Math.max(0, Math.min(100, ((livePwm - 1000) / 1000) * 100))}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-text-primary tabular-nums w-10 text-right">
                          {livePwm}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] font-mono text-text-tertiary">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
