/**
 * @module MotorMixerTable
 * @description Motor mixer rule table for iNav. Sub-component of
 * MixerProfilePanel; renders one row per motor rule with throttle/roll/pitch/yaw
 * inputs and remove + add controls.
 * @license GPL-3.0-only
 */

"use client";

import { useMixerStore } from "@/stores/mixer-store";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { MotorMixerRule } from "@/lib/protocol/msp/msp-decoders-inav";

const INPUT_CLASS =
  "bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary w-full";

interface MotorMixerTableProps {
  isArmed: boolean;
  lockMessage: string;
}

export function MotorMixerTable({ isArmed, lockMessage }: MotorMixerTableProps) {
  const motorRules = useMixerStore((s) => s.motorRules);
  const motorSlots = useMixerStore((s) => s.motorSlots);
  const setMotorRule = useMixerStore((s) => s.setMotorRule);
  const removeMotorRule = useMixerStore((s) => s.removeMotorRule);
  const addMotorRule = useMixerStore((s) => s.addMotorRule);

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide">
        Motor mixer ({motorRules.length}/{motorSlots ?? "—"})
      </p>
      {motorRules.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="text-text-tertiary border-b border-border-default">
                <th className="text-left py-1 pr-2">#</th>
                <th className="text-left py-1 pr-2">Throttle</th>
                <th className="text-left py-1 pr-2">Roll</th>
                <th className="text-left py-1 pr-2">Pitch</th>
                <th className="text-left py-1 pr-2">Yaw</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {motorRules.map((rule, idx) => (
                <tr key={idx} className="border-b border-border-default/40">
                  <td className="py-1 pr-2 text-text-tertiary">{idx}</td>
                  {(["throttle", "roll", "pitch", "yaw"] as (keyof MotorMixerRule)[]).map((field) => (
                    <td key={field} className="py-1 pr-2">
                      <input
                        type="number"
                        min={-2}
                        max={2}
                        step={0.01}
                        value={rule[field]}
                        disabled={isArmed}
                        className={INPUT_CLASS}
                        onChange={(e) =>
                          setMotorRule(idx, { [field]: parseFloat(e.target.value) || 0 })
                        }
                        onBlur={() => {
                          // The FC stores weights in [-2, 2]; clamp only a value the
                          // operator actually pushed outside that range.
                          const v = Math.min(2, Math.max(-2, rule[field]));
                          if (v !== rule[field]) setMotorRule(idx, { [field]: v });
                        }}
                      />
                    </td>
                  ))}
                  <td className="py-1">
                    <button
                      disabled={isArmed}
                      title={isArmed ? lockMessage : "Remove rule"}
                      onClick={() => removeMotorRule(idx)}
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
      {motorSlots !== null && motorRules.length < motorSlots && (
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={12} />}
          disabled={isArmed}
          title={isArmed ? lockMessage : undefined}
          onClick={() => addMotorRule({ throttle: 1, roll: 0, pitch: 0, yaw: 0 })}
        >
          Add motor rule
        </Button>
      )}
    </div>
  );
}
