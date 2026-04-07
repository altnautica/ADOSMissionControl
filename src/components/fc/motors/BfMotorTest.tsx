"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Play, Square } from "lucide-react";

const MOTOR_COUNT = 4;

export function BfMotorTest({ connected }: { connected: boolean }) {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { isHardBlocked } = useArmedLock();

  const [motorTestActive, setMotorTestActive] = useState(false);
  const [motorValues, setMotorValues] = useState<number[]>(Array(MOTOR_COUNT).fill(0));
  const [masterValue, setMasterValue] = useState(0);
  const [propsRemoved, setPropsRemoved] = useState(false);
  const motorTestIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startMotorTest = useCallback(() => {
    if (isHardBlocked) {
      toast("Cannot test motors while armed", "error");
      return;
    }
    setMotorTestActive(true);
    toast("Motor test started. Keep clear of props!", "warning");
  }, [isHardBlocked, toast]);

  const stopMotorTest = useCallback(() => {
    const protocol = getSelectedProtocol();
    if (protocol?.isConnected) {
      for (let i = 0; i < MOTOR_COUNT; i++) {
        protocol.motorTest(i, 0, 0).catch(() => {});
      }
    }
    setMotorTestActive(false);
    setMotorValues(Array(MOTOR_COUNT).fill(0));
    setMasterValue(0);
    if (motorTestIntervalRef.current) {
      clearInterval(motorTestIntervalRef.current);
      motorTestIntervalRef.current = null;
    }
  }, [getSelectedProtocol]);

  useEffect(() => {
    return () => {
      if (motorTestIntervalRef.current) {
        clearInterval(motorTestIntervalRef.current);
      }
    };
  }, []);

  const setMotorThrottle = useCallback(
    (motor: number, pct: number) => {
      const protocol = getSelectedProtocol();
      if (!protocol?.isConnected || !motorTestActive) return;
      setMotorValues((prev) => {
        const next = [...prev];
        next[motor] = pct;
        return next;
      });
      protocol.motorTest(motor, pct, 0).catch(() => {});
    },
    [getSelectedProtocol, motorTestActive]
  );

  const setAllMotors = useCallback(
    (pct: number) => {
      const protocol = getSelectedProtocol();
      if (!protocol?.isConnected || !motorTestActive) return;
      setMasterValue(pct);
      setMotorValues(Array(MOTOR_COUNT).fill(pct));
      for (let i = 0; i < MOTOR_COUNT; i++) {
        protocol.motorTest(i, pct, 0).catch(() => {});
      }
    },
    [getSelectedProtocol, motorTestActive]
  );

  return (
    <>
      {/* Safety warning */}
      <div className="flex items-start gap-2 p-3 bg-status-error/10 border border-status-error/20 rounded">
        <AlertTriangle size={16} className="text-status-error shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-status-error">REMOVE ALL PROPELLERS BEFORE TESTING</p>
          <p className="text-[10px] text-status-error/80 mt-0.5">
            Motors will spin when tested. Failure to remove propellers can result in injury or damage.
          </p>
        </div>
      </div>

      {/* Props removed acknowledgment */}
      <label className="flex items-center gap-2 cursor-pointer mt-2">
        <input
          type="checkbox"
          checked={propsRemoved}
          onChange={(e) => setPropsRemoved(e.target.checked)}
          className="w-4 h-4 rounded border-border-default bg-bg-tertiary accent-accent-primary"
        />
        <span className="text-xs text-text-secondary">I confirm all propellers have been removed</span>
      </label>

      {/* Motor controls */}
      {propsRemoved && (
        <div className="space-y-4 mt-3">
          <div className="flex items-center gap-2">
            {!motorTestActive ? (
              <Button variant="primary" size="sm" icon={<Play size={12} />} onClick={startMotorTest} disabled={isHardBlocked || !connected}>
                Enable Motor Test
              </Button>
            ) : (
              <Button variant="secondary" size="sm" icon={<Square size={12} />} onClick={stopMotorTest} className="border-status-error text-status-error">
                Stop All Motors
              </Button>
            )}
            {isHardBlocked && <span className="text-[10px] text-status-error">Disarm to test motors</span>}
          </div>

          {/* Individual motor sliders */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: MOTOR_COUNT }, (_, i) => (
              <div key={i} className="text-center space-y-2">
                <span className="text-xs font-mono text-text-secondary">Motor {i + 1}</span>
                <div className="relative mx-auto w-8">
                  <input
                    type="range" min="0" max="100" value={motorValues[i]}
                    onChange={(e) => setMotorThrottle(i, Number(e.target.value))}
                    disabled={!motorTestActive}
                    className="w-24 -rotate-90 translate-y-10 origin-center accent-accent-primary disabled:opacity-30"
                    style={{ height: "2rem", marginTop: "2rem", marginBottom: "2rem" }}
                  />
                </div>
                <span className={`text-sm font-mono tabular-nums ${motorValues[i] > 0 ? "text-status-warning" : "text-text-tertiary"}`}>
                  {motorValues[i]}%
                </span>
              </div>
            ))}
          </div>

          {/* Master slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-text-secondary">
              <span>Master Throttle</span>
              <span className="font-mono tabular-nums">{masterValue}%</span>
            </div>
            <input
              type="range" min="0" max="100" value={masterValue}
              onChange={(e) => setAllMotors(Number(e.target.value))}
              disabled={!motorTestActive}
              className="w-full accent-accent-primary disabled:opacity-30"
            />
            <div className="flex justify-between text-[8px] text-text-tertiary font-mono">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
