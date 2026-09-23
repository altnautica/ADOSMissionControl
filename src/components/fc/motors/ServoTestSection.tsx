"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { AlertTriangle } from "lucide-react";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { OutputRow } from "../misc/ServoMappingTable";
import { ServoCommandCoalescer } from "./servo-command-coalescer";

const OUTPUT_COUNT = 16;

interface ServoTestSectionProps {
  protocol: DroneProtocol | null;
  /** Hard-block flag — servo test is unsafe in flight. */
  isHardBlocked: boolean;
  hardBlockMessage: string;
  /** One entry per output, null where the output's parameters were not read. */
  outputs: (OutputRow | null)[];
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

  const senderRef = useRef<ServoCommandCoalescer | null>(null);
  useEffect(() => {
    if (!protocol) return;
    const sender = new ServoCommandCoalescer((output, pwm) => protocol.setServo(output, pwm));
    senderRef.current = sender;
    return () => {
      sender.dispose();
      if (senderRef.current === sender) senderRef.current = null;
    };
  }, [protocol]);

  // Output numbers are the FC's own (1-based). GPIO outputs and outputs whose
  // configuration was not read are not offered: driving one could toggle a
  // relay or camera pin.
  const testable = useMemo(
    () =>
      outputs.flatMap((row, i) =>
        row !== null && !gpioOutputs.has(i + 1) ? [i + 1] : [],
      ),
    [outputs, gpioOutputs],
  );

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
            {testable.map((n) => (
              <div key={n} className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-text-secondary w-5 text-right">{n}</span>
                <input
                  type="range"
                  min={1000}
                  max={2000}
                  aria-label={`Servo ${n} PWM`}
                  value={servoTestValues[n - 1]}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setServoTestValues((prev) => {
                      const next = [...prev];
                      next[n - 1] = val;
                      return next;
                    });
                    senderRef.current?.request(n, val);
                  }}
                  className="flex-1 accent-accent-primary"
                />
                <span className="text-[10px] font-mono text-text-primary tabular-nums w-10 text-right">{servoTestValues[n - 1]}</span>
                <span className="text-[10px] font-mono text-text-tertiary">µs</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
