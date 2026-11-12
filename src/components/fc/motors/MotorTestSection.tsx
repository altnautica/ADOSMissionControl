"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { Zap, AlertTriangle, Square } from "lucide-react";
import type { DroneProtocol } from "@/lib/protocol/types";

/** Highest throttle a bench motor test may command, percent. */
export const MOTOR_TEST_MAX_THROTTLE = 20;

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
  const tr = useTranslations("fcPanels.motorTestSection");
  const tBf = useTranslations("fcPanels.bfMotorTest");
  const [propsOff, setPropsOff] = useState(false);
  const { toast } = useToast();
  const t = useTranslations("fcToasts.motors");
  const [motorTestEnabled, setMotorTestEnabled] = useState(false);
  const [testMotor, setTestMotor] = useState("1");
  const [testThrottle, setTestThrottle] = useState(5);
  const [testDuration, setTestDuration] = useState(3);
  const [motorTesting, setMotorTesting] = useState(false);

  useEffect(() => {
    if (isHardBlocked) {
      setMotorTestEnabled(false);
      setPropsOff(false);
    }
  }, [isHardBlocked]);

  const runMotorTest = useCallback(async () => {
    if (!protocol || !motorTestEnabled || !propsOff) return;
    setMotorTesting(true);
    try {
      // The FC can refuse (armed, wrong mode, safety switch) or never answer;
      // both resolve with success=false rather than throwing.
      const result = await protocol.motorTest(
        Number(testMotor),
        Math.min(testThrottle, MOTOR_TEST_MAX_THROTTLE),
        testDuration,
      );
      if (result.success) {
        toast(t("motorTestRunning", { motor: testMotor }), "info");
      } else {
        toast(t("motorTestNotRun", { motor: testMotor, reason: result.message || t("motorTestNoReason") }), "error");
      }
    } catch {
      toast(t("motorTestFailed"), "error");
    } finally {
      setMotorTesting(false);
    }
  }, [protocol, motorTestEnabled, propsOff, testMotor, testThrottle, testDuration, toast, t]);

  // Zero throttle with a one-second hold ends any test still spinning.
  const stopMotorTest = useCallback(() => {
    if (!protocol) return;
    void protocol.motorTest(Number(testMotor), 0, 1).catch(() => undefined);
  }, [protocol, testMotor]);

  const motorOptions = useMemo(
    () => Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: tr("motorN", { n: i + 1 }) })),
    [tr],
  );

  return (
    <Card title={tr("motorTest")}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-2 bg-status-error/10 border border-status-error/20">
          <AlertTriangle size={14} className="text-status-error shrink-0" />
          <span className="text-[10px] text-status-error">
            {tr("removePropellersBeforeTestingMotors")}
          </span>
        </div>

        <Toggle label={tr("enableMotorTestSafetyMaster")} checked={motorTestEnabled} onChange={setMotorTestEnabled} disabled={isHardBlocked} />

        {isHardBlocked && (
          <div className="flex items-center gap-2 p-2 bg-status-error/10 border border-status-error/20">
            <AlertTriangle size={14} className="text-status-error shrink-0" />
            <span className="text-[10px] text-status-error">{hardBlockMessage}</span>
          </div>
        )}

        {motorTestEnabled && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-text-primary">
              <input type="checkbox" checked={propsOff} onChange={(e) => setPropsOff(e.target.checked)} />
              {tBf("iConfirmAllPropellersHave")}
            </label>
            <Select label={tr("motor")} options={motorOptions} value={testMotor} onChange={setTestMotor} />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">
                {tr("throttleLabel", { value: testThrottle, max: MOTOR_TEST_MAX_THROTTLE })}
              </label>
              <input type="range" min={0} max={MOTOR_TEST_MAX_THROTTLE} value={testThrottle} onChange={(e) => setTestThrottle(Number(e.target.value))} className="w-full accent-accent-primary" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">{tr("durationLabel", { value: testDuration })}</label>
              <input type="range" min={1} max={10} value={testDuration} onChange={(e) => setTestDuration(Number(e.target.value))} className="w-full accent-accent-primary" />
            </div>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                icon={<Zap size={12} />}
                loading={motorTesting}
                disabled={!propsOff}
                onClick={runMotorTest}
              >
                {tr("testMotorN", { n: testMotor })}
              </Button>
              <Button variant="secondary" size="sm" icon={<Square size={12} />} onClick={stopMotorTest}>
                {tr("stop")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
