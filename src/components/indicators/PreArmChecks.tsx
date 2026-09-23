"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useSensorHealth } from "@/hooks/use-sensor-health";
import { decodeSensorHealth } from "@/lib/sensor-health";
import { freshOnly } from "@/lib/telemetry/freshness";
import { cn, formatErrorMessage } from "@/lib/utils";
import { Check, X, AlertTriangle, RefreshCw, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BulkTrimFix, RcNeutralQuickFix } from "./PreArmTrimFix";

// ── Quick-fix types ─────────────────────────────────────────

interface QuickFixAction {
  type: string;
  label: string;
  context: Record<string, unknown>;
}

interface PreArmMessage {
  text: string;
  suggestion: string;
  quickFix: QuickFixAction | null;
}

// ── Fix database ────────────────────────────────────────────

/** Common pre-arm failure messages and their fix suggestions. */
const FIX_DATABASE: Record<string, string> = {
  "compass not calibrated": "Go to Calibration tab and run Compass calibration",
  "accelerometers not calibrated": "Go to Calibration tab and run Accelerometer calibration",
  "barometer not healthy": "Check barometer sensor connection",
  "gps not found": "Check GPS module connection and wiring",
  "radio failsafe": "Check RC transmitter is on and bound",
  "battery failsafe": "Check battery voltage or adjust BATT_LOW_VOLT",
  "logging not started": "Insert SD card or check LOG_BACKEND_TYPE",
  "fence requires position": "Wait for GPS 3D fix before enabling geofence",
  "check firmware": "Firmware may need updating",
  "gyros not calibrated": "Keep vehicle still and run Gyro calibration",
  "need 3d fix": "Wait for GPS to acquire 3D fix",
  "bad velocity": "Wait for EKF to settle",
  "high magnetic interference": "Move vehicle away from metal objects",
  "check board voltage": "Check power supply voltage",
  "hardware safety switch": "Press safety switch on vehicle",
  "on disabled channel": "A servo function is assigned to an output disabled by a timer group protocol conflict. Outputs sharing a hardware timer must all use the same protocol (PWM or DShot). Go to Configure → Outputs to see the timer group diagram and move the conflicting function to a group without DShot motors.",
  "is not neutral": "RC stick resting position is outside the trim deadzone (RCx_TRIM ± RCx_DZ). Go to Configure → Receiver, check the live RC value, and either adjust RCx_TRIM to match the stick's resting position or increase RCx_DZ.",
  "not healthy": "Sensor reporting unhealthy — check wiring and connections, or wait for sensor to initialize",
  "gps 1": "Check GPS module connection, ensure antenna has clear sky view, wait for 3D fix",
};

function findSuggestion(text: string): string {
  const lower = text.toLowerCase();
  for (const [pattern, suggestion] of Object.entries(FIX_DATABASE)) {
    if (lower.includes(pattern)) return suggestion;
  }
  return "Check vehicle hardware and configuration";
}

// ── Quick-fix detection ─────────────────────────────────────

const RC_NEUTRAL_REGEX = /\(RC(\d+)\)\s*is not neutral/i;

function findQuickFix(text: string): QuickFixAction | null {
  const match = text.match(RC_NEUTRAL_REGEX);
  if (match) {
    return {
      type: "rc-set-trim",
      label: `Set RC${match[1]} Trim to Current`,
      context: { channelNumber: parseInt(match[1], 10) },
    };
  }
  return null;
}

// ── Main component ──────────────────────────────────────────

/**
 * Failure-bearing STATUSTEXT prefixes: ArduPilot "PreArm:" / "Arm:", PX4
 * "Preflight Fail:" / "Arming denied:".
 */
const PREARM_FAILURE_PREFIX = /^(PreArm|Arm|Preflight Fail|Arming denied):\s*/;

/** How long MAVLink failures are collected after the FC accepts the request. */
const STATUSTEXT_WINDOW_MS = 3000;

/** Append a failure row unless the same text is already listed. */
function appendFailure(prev: PreArmMessage[], text: string): PreArmMessage[] {
  if (prev.some((f) => f.text === text)) return prev;
  return [...prev, { text, suggestion: findSuggestion(text), quickFix: findQuickFix(text) }];
}

/**
 * Pre-arm check with pass/fail status and fix suggestions.
 *
 * "All passed" needs evidence: over MSP the arming-disable word the protocol
 * decodes, over MAVLink the FC's fresh SYS_STATUS pre-arm bit. A refused or
 * failed request is itself a failure. When the FC sends no verdict and no
 * failures, the panel says exactly that instead of claiming a pass.
 */
export function PreArmChecks({ className }: { className?: string }) {
  const t = useTranslations("preArm");
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const { healthyCount, presentCount: totalPresent } = useSensorHealth();
  const [failures, setFailures] = useState<PreArmMessage[]>([]);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  /** Whether the finished check carries a positive verdict from the FC. */
  const [verdictPass, setVerdictPass] = useState(false);

  const addFailure = (text: string) => setFailures((prev) => appendFailure(prev, text));

  // Subscribe to STATUSTEXT for pre-arm failures
  useEffect(() => {
    if (!protocol) return;

    const unsub = protocol.onStatusText?.((data) => {
      if (!PREARM_FAILURE_PREFIX.test(data.text)) return;
      const cleanText = data.text.replace(PREARM_FAILURE_PREFIX, "").trim();
      setFailures((prev) => appendFailure(prev, cleanText));
    });

    return () => {
      unsub?.();
    };
  }, [protocol]);

  async function runCheck() {
    if (!protocol) return;
    setChecking(true);
    setFailures([]);
    setVerdictPass(false);
    try {
      const result = await protocol.doPreArmCheck();
      if (!result.success) {
        addFailure(result.message);
        return;
      }
      if (protocol.protocolName === "msp") {
        // The MSP result is the decoded arming-disable word: a real verdict.
        setVerdictPass(true);
        return;
      }
      // MAVLink: the FC accepted the request; failures follow on STATUSTEXT
      // and the verdict is the SYS_STATUS pre-arm bit.
      const windowClosed = Promise.withResolvers<void>();
      setTimeout(windowClosed.resolve, STATUSTEXT_WINDOW_MS);
      await windowClosed.promise;
      const sysStatus = freshOnly(useTelemetryStore.getState().sysStatus.latest(), Date.now());
      const prearm = sysStatus
        ? decodeSensorHealth(sysStatus).find((s) => s.name === "pre_arm_check")
        : undefined;
      if (prearm) {
        if (prearm.healthy) setVerdictPass(true);
        else if (prearm.present) addFailure(t("fcReportsFailures"));
      }
    } catch (err) {
      addFailure(formatErrorMessage(err));
    } finally {
      setChecking(false);
      setLastChecked(Date.now());
    }
  }

  const finished = lastChecked !== null && !checking && failures.length === 0;
  const allClear = finished && verdictPass;
  const unconfirmed = finished && !verdictPass;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Header with check button */}
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex-1">
          {t("title")}
        </h3>
        <span className="text-[10px] text-text-tertiary font-mono">
          {t("sensors")}: {healthyCount}/{totalPresent}
        </span>
        <Button size="sm" onClick={runCheck} disabled={checking || !protocol}>
          <RefreshCw size={10} className={checking ? "animate-spin" : ""} />
          {checking ? t("checking") : t("runCheck")}
        </Button>
      </div>

      {/* Results */}
      {checking && (
        <div className="text-[10px] text-text-tertiary animate-pulse">
          {t("runningChecks")}
        </div>
      )}

      {allClear && (
        <div className="flex items-center gap-1.5 text-status-success text-xs">
          <Check size={14} />
          <span>{t("allPassed")}</span>
        </div>
      )}

      {unconfirmed && (
        <div className="flex items-center gap-1.5 text-text-secondary text-xs">
          <CircleHelp size={14} />
          <span>{t("noFailuresReported")}</span>
        </div>
      )}

      {failures.length > 0 && (
        <div className="space-y-1">
          {/* Bulk trim fix when 2+ RC neutral failures */}
          {(() => {
            const rcFailures = failures.filter(f => f.quickFix?.type === "rc-set-trim");
            if (rcFailures.length >= 2) {
              return (
                <BulkTrimFix
                  channels={rcFailures.map(f => f.quickFix!.context.channelNumber as number)}
                  onFixed={runCheck}
                />
              );
            }
            return null;
          })()}
          {failures.map((failure, i) => (
            <div key={i}>
              <div className="flex items-start gap-1.5 text-[11px]">
                <X size={12} className="text-status-error shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="text-text-primary font-medium">{failure.text}</span>
                  <p className="text-text-tertiary text-[10px]">
                    <AlertTriangle size={9} className="inline mr-0.5" />
                    {failure.suggestion}
                  </p>
                </div>
              </div>
              {failure.quickFix?.type === "rc-set-trim" && (
                <RcNeutralQuickFix
                  channelNumber={failure.quickFix.context.channelNumber as number}
                  onTrimApplied={runCheck}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {!lastChecked && !checking && (
        <div className="text-[10px] text-text-tertiary">
          {t("clickToRun")}
        </div>
      )}
    </div>
  );
}
