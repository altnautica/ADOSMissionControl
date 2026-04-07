"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { AlertTriangle } from "lucide-react";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { OutputRow } from "../misc/ServoMappingTable";

const OUTPUT_COUNT = 16;

interface ServoTestSectionProps {
  protocol: DroneProtocol | null;
  /** Hard-block flag — servo test is unsafe in flight. */
  isHardBlocked: boolean;
  hardBlockMessage: string;
  outputs: OutputRow[];
  gpioOutputs: Set<number>;
}

export function ServoTestSection({ protocol, isHardBlocked, hardBlockMessage, outputs, gpioOutputs }: ServoTestSectionProps) {
  const [servoTestEnabled, setServoTestEnabled] = useState(false);
  const [servoTestValues, setServoTestValues] = useState<number[]>(
    () => Array.from({ length: OUTPUT_COUNT }, () => 1500),
  );

  useEffect(() => {
    if (isHardBlocked) setServoTestEnabled(false);
  }, [isHardBlocked]);

  return (
    <Card title="Servo Test">
      <div className="space-y-3">
        <div className="flex items-center gap-2 p-2 bg-status-warning/10 border border-status-warning/20">
          <AlertTriangle size={14} className="text-status-warning shrink-0" />
          <span className="text-[10px] text-status-warning">
            Servo test sends live PWM commands. Ensure servos are safe to move.
          </span>
        </div>

        <Toggle label="Enable servo test (safety master)" checked={servoTestEnabled} onChange={setServoTestEnabled} disabled={isHardBlocked} />

        {isHardBlocked && (
          <div className="flex items-center gap-2 p-2 bg-status-error/10 border border-status-error/20">
            <AlertTriangle size={14} className="text-status-error shrink-0" />
            <span className="text-[10px] text-status-error">{hardBlockMessage}</span>
          </div>
        )}

        {servoTestEnabled && (
          <div className="space-y-2">
            {outputs.filter((_, i) => !gpioOutputs.has(i + 1)).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-text-secondary w-5 text-right">{i + 1}</span>
                <input
                  type="range"
                  min={1000}
                  max={2000}
                  value={servoTestValues[i]}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setServoTestValues((prev) => {
                      const next = [...prev];
                      next[i] = val;
                      return next;
                    });
                    if (protocol) {
                      protocol.setServo(i + 1, val);
                    }
                  }}
                  className="flex-1 accent-accent-primary"
                />
                <span className="text-[10px] font-mono text-text-primary tabular-nums w-10 text-right">{servoTestValues[i]}</span>
                <span className="text-[10px] font-mono text-text-tertiary">µs</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
