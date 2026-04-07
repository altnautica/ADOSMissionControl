"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { Zap, AlertTriangle } from "lucide-react";
import type { DroneProtocol } from "@/lib/protocol/types";

interface MotorTestSectionProps {
  protocol: DroneProtocol | null;
  /**
   * Hard-block flag. Motor test is genuinely unsafe in flight — never
   * allow it while armed regardless of user override.
   */
  isHardBlocked: boolean;
  hardBlockMessage: string;
}

export function MotorTestSection({ protocol, isHardBlocked, hardBlockMessage }: MotorTestSectionProps) {
  const { toast } = useToast();
  const [motorTestEnabled, setMotorTestEnabled] = useState(false);
  const [testMotor, setTestMotor] = useState("1");
  const [testThrottle, setTestThrottle] = useState(5);
  const [testDuration, setTestDuration] = useState(3);
  const [motorTesting, setMotorTesting] = useState(false);

  useEffect(() => {
    if (isHardBlocked) setMotorTestEnabled(false);
  }, [isHardBlocked]);

  const runMotorTest = useCallback(async () => {
    if (!protocol || !motorTestEnabled) return;
    setMotorTesting(true);
    try {
      await protocol.motorTest(Number(testMotor), testThrottle, testDuration);
      toast(`Motor ${testMotor} test complete`, "info");
    } catch {
      toast("Motor test failed", "error");
    } finally {
      setMotorTesting(false);
    }
  }, [protocol, motorTestEnabled, testMotor, testThrottle, testDuration, toast]);

  const motorOptions = useMemo(
    () => Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Motor ${i + 1}` })),
    [],
  );

  return (
    <Card title="Motor Test">
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-2 bg-status-error/10 border border-status-error/20">
          <AlertTriangle size={14} className="text-status-error shrink-0" />
          <span className="text-[10px] text-status-error">
            Remove propellers before testing motors. Ensure drone is secured.
          </span>
        </div>

        <Toggle label="Enable motor test (safety master)" checked={motorTestEnabled} onChange={setMotorTestEnabled} disabled={isHardBlocked} />

        {isHardBlocked && (
          <div className="flex items-center gap-2 p-2 bg-status-error/10 border border-status-error/20">
            <AlertTriangle size={14} className="text-status-error shrink-0" />
            <span className="text-[10px] text-status-error">{hardBlockMessage}</span>
          </div>
        )}

        {motorTestEnabled && (
          <div className="space-y-3">
            <Select label="Motor" options={motorOptions} value={testMotor} onChange={setTestMotor} />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Throttle: {testThrottle}%</label>
              <input type="range" min={0} max={100} value={testThrottle} onChange={(e) => setTestThrottle(Number(e.target.value))} className="w-full accent-accent-primary" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Duration: {testDuration}s</label>
              <input type="range" min={1} max={10} value={testDuration} onChange={(e) => setTestDuration(Number(e.target.value))} className="w-full accent-accent-primary" />
            </div>
            <Button variant="danger" size="sm" icon={<Zap size={12} />} loading={motorTesting} onClick={runMotorTest}>
              Test Motor {testMotor}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
