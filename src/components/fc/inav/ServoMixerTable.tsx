/**
 * @module ServoMixerTable
 * @description Servo mixer rule table for iNav. Sub-component of
 * MixerProfilePanel; renders one row per servo rule with target channel,
 * input source, rate, speed, and condition controls.
 * @license GPL-3.0-only
 */

"use client";

import { useMixerStore } from "@/stores/mixer-store";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

const INPUT_CLASS =
  "bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary w-full";

const INPUT_SOURCE_OPTIONS = [
  { value: "0", label: "Stabilized ROLL" },
  { value: "1", label: "Stabilized PITCH" },
  { value: "2", label: "Stabilized YAW" },
  { value: "3", label: "Stabilized THROTTLE" },
  { value: "4", label: "RC Roll" },
  { value: "5", label: "RC Pitch" },
  { value: "6", label: "RC Yaw" },
  { value: "7", label: "RC Throttle" },
  { value: "8", label: "RC AUX 1" },
  { value: "9", label: "RC AUX 2" },
  { value: "10", label: "RC AUX 3" },
  { value: "11", label: "RC AUX 4" },
];

/** iNav MAX_LOGIC_CONDITIONS. */
const LOGIC_CONDITION_COUNT = 64;

/** -1 gates the rule on nothing (iNav's default); 0..63 gate it on that logic condition. */
const CONDITION_OPTIONS = [
  { value: "-1", label: "Always" },
  ...Array.from({ length: LOGIC_CONDITION_COUNT }, (_, i) => ({ value: String(i), label: `Logic condition ${i}` })),
];

interface ServoMixerTableProps {
  isArmed: boolean;
  lockMessage: string;
}

export function ServoMixerTable({ isArmed, lockMessage }: ServoMixerTableProps) {
  const servoRules = useMixerStore((s) => s.servoRules);
  const servoSlots = useMixerStore((s) => s.servoSlots);
  const setServoRule = useMixerStore((s) => s.setServoRule);
  const removeServoRule = useMixerStore((s) => s.removeServoRule);
  const addServoRule = useMixerStore((s) => s.addServoRule);

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide">
        Servo mixer ({servoRules.length}/{servoSlots ?? "—"})
      </p>
      {servoRules.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="text-text-tertiary border-b border-border-default">
                <th className="text-left py-1 pr-2">#</th>
                <th className="text-left py-1 pr-2">Target ch</th>
                <th className="text-left py-1 pr-2">Input source</th>
                <th className="text-left py-1 pr-2">Rate</th>
                <th className="text-left py-1 pr-2">Speed</th>
                <th className="text-left py-1 pr-2">Condition</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {servoRules.map((rule, idx) => (
                <tr key={idx} className="border-b border-border-default/40">
                  <td className="py-1 pr-2 text-text-tertiary">{idx}</td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min={0}
                      max={17}
                      value={rule.targetChannel}
                      disabled={isArmed}
                      className={INPUT_CLASS}
                      onChange={(e) =>
                        setServoRule(idx, {
                          targetChannel: parseInt(e.target.value) || 0,
                        })
                      }
                      onBlur={(e) =>
                        setServoRule(idx, {
                          targetChannel: Math.min(
                            17,
                            Math.max(0, parseInt(e.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2 min-w-[140px]">
                    <Select
                      label=""
                      options={INPUT_SOURCE_OPTIONS}
                      value={String(rule.inputSource)}
                      disabled={isArmed}
                      onChange={(v) => setServoRule(idx, { inputSource: parseInt(v) })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min={-1000}
                      max={1000}
                      value={rule.rate}
                      disabled={isArmed}
                      className={INPUT_CLASS}
                      onChange={(e) =>
                        setServoRule(idx, { rate: parseInt(e.target.value) || 0 })
                      }
                      onBlur={(e) =>
                        setServoRule(idx, {
                          rate: Math.min(
                            1000,
                            Math.max(-1000, parseInt(e.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={rule.speed}
                      disabled={isArmed}
                      className={INPUT_CLASS}
                      onChange={(e) =>
                        setServoRule(idx, { speed: parseInt(e.target.value) || 0 })
                      }
                      onBlur={(e) =>
                        setServoRule(idx, {
                          speed: Math.min(
                            10,
                            Math.max(0, parseInt(e.target.value) || 0),
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2 min-w-[150px]">
                    <Select
                      label=""
                      options={CONDITION_OPTIONS}
                      value={String(rule.conditionId)}
                      disabled={isArmed}
                      searchable
                      onChange={(v) => setServoRule(idx, { conditionId: parseInt(v, 10) })}
                    />
                  </td>
                  <td className="py-1">
                    <button
                      disabled={isArmed}
                      title={isArmed ? lockMessage : "Remove rule"}
                      onClick={() => removeServoRule(idx)}
                      className="text-status-error hover:opacity-80 disabled:opacity-40 p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {servoSlots !== null && servoRules.length < servoSlots && (
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={12} />}
          disabled={isArmed}
          title={isArmed ? lockMessage : undefined}
          onClick={() =>
            addServoRule({
              targetChannel: 0,
              inputSource: 0,
              rate: 100,
              speed: 0,
              conditionId: -1,
            })
          }
        >
          Add servo rule
        </Button>
      )}
    </div>
  );
}
