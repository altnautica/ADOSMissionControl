"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useSensorHealthStore } from "@/stores/sensor-health-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { cn } from "@/lib/utils";
import { Check, X, AlertTriangle, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

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

// ── RC Neutral Quick Fix component ──────────────────────────

function RcNeutralQuickFix({ channelNumber, onTrimApplied }: { channelNumber: number; onTrimApplied?: () => void }) {
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const rcBuffer = useTelemetryStore((s) => s.rc);
  const latestRc = rcBuffer.latest();
  const channels = latestRc?.channels ?? [];
  const currentValue = channels[channelNumber - 1] ?? 0;

  const [trimValue, setTrimValue] = useState<number | null>(null);
  const [dzValue, setDzValue] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Fetch current trim and DZ params
  useEffect(() => {
    if (!protocol) return;
    Promise.allSettled([
      protocol.getParameter(`RC${channelNumber}_TRIM`),
      protocol.getParameter(`RC${channelNumber}_DZ`),
    ]).then(([trimResult, dzResult]) => {
      if (trimResult.status === "fulfilled") setTrimValue(trimResult.value.value);
      if (dzResult.status === "fulfilled") setDzValue(dzResult.value.value);
    });
  }, [protocol, channelNumber]);

  async function applyTrim() {
    if (!protocol || currentValue === 0) return;
    setApplying(true);
    await protocol.setParameter(`RC${channelNumber}_TRIM`, currentValue);
    setTrimValue(currentValue);
    setApplying(false);
    setApplied(true);
    setTimeout(() => onTrimApplied?.(), 500);
  }

  const offset = trimValue !== null && currentValue > 0 ? Math.abs(currentValue - trimValue) : null;
  const outsideDz = offset !== null && dzValue !== null && offset > dzValue;

  return (
    <div className="mt-1.5 ml-3 p-2 bg-bg-tertiary border border-border-default space-y-1.5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono">
        <span className="text-text-tertiary">RC{channelNumber} Current:</span>
        <span className="text-text-primary">{currentValue || "—"}</span>
        <span className="text-text-tertiary">RC{channelNumber}_TRIM:</span>
        <span className="text-text-primary">{trimValue ?? "—"}</span>
        <span className="text-text-tertiary">RC{channelNumber}_DZ:</span>
        <span className="text-text-primary">{dzValue ?? "—"}</span>
        {offset !== null && (
          <>
            <span className="text-text-tertiary">Offset:</span>
            <span className={outsideDz ? "text-status-error" : "text-status-success"}>
              {offset}{outsideDz ? " (outside DZ)" : " (within DZ)"}
            </span>
          </>
        )}
      </div>
      {applied ? (
        <div className="flex items-center gap-1 text-[10px] text-status-success">
          <Check size={10} />
          <span>Trim set to {currentValue} — re-checking...</span>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          icon={<Wrench size={10} />}
          loading={applying}
          disabled={currentValue === 0}
          onClick={applyTrim}
        >
          Set RC{channelNumber} Trim to {currentValue || "..."}
        </Button>
      )}
    </div>
  );
}

// ── Bulk Trim Fix ────────────────────────────────────────────

function BulkTrimFix({ channels, onFixed }: { channels: number[]; onFixed: () => void }) {
  const t = useTranslations("preArm");
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const rcBuffer = useTelemetryStore((s) => s.rc);
  const latestRc = rcBuffer.latest();
  const allChannels = latestRc?.channels ?? [];
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  async function fixAll() {
    if (!protocol) return;
    setApplying(true);
    for (const ch of channels) {
      const current = allChannels[ch - 1] ?? 0;
      if (current > 0) {
        await protocol.setParameter(`RC${ch}_TRIM`, current);
      }
    }
    setApplying(false);
    setApplied(true);
    setTimeout(onFixed, 500);
  }

  if (applied) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-status-success p-2 bg-status-success/10 border border-status-success/20">
        <Check size={10} />
        <span>{t("allTrimsFixed")}</span>
      </div>
    );
  }

  return (
    <div className="p-2 bg-accent-primary/10 border border-accent-primary/20 space-y-1.5">
      <div className="flex items-center gap-2">
        <Wrench size={10} className="text-accent-primary" />
        <span className="text-[10px] text-text-primary font-medium">
          {t("rcChannelsOutside", { count: channels.length })}
        </span>
      </div>
      <div className="space-y-0.5">
        {channels.map(ch => {
          const current = allChannels[ch - 1] ?? 0;
          return (
            <div key={ch} className="text-[10px] font-mono text-text-tertiary">
              RC{ch}_TRIM → {current || "—"}
            </div>
          );
        })}
      </div>
      <Button
        size="sm"
        variant="primary"
        icon={<Wrench size={10} />}
        loading={applying}
        onClick={fixAll}
      >
        {t("fixAllTrims")}
      </Button>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────

/**
 * Pre-arm check checklist with pass/fail status and fix suggestions.
 * Captures STATUSTEXT messages with "PreArm:" prefix.
 */
export function PreArmChecks({ className }: { className?: string }) {
  const t = useTranslations("preArm");
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const healthyCount = useSensorHealthStore((s) => s.getHealthySensorCount());
  const totalPresent = useSensorHealthStore((s) => s.getTotalPresentCount());
  const [failures, setFailures] = useState<PreArmMessage[]>([]);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Subscribe to STATUSTEXT for PreArm messages
  useEffect(() => {
    if (!protocol) return;

    const unsub = protocol.onStatusText?.((data) => {
      if (data.text.startsWith("PreArm:") || data.text.startsWith("Arm:")) {
        const cleanText = data.text.replace(/^(PreArm:|Arm:)\s*/, "");
        setFailures((prev) => {
          // Deduplicate
          if (prev.some((f) => f.text === cleanText)) return prev;
          return [...prev, {
            text: cleanText,
            suggestion: findSuggestion(cleanText),
            quickFix: findQuickFix(cleanText),
          }];
        });
      }
    });
    unsubRef.current = unsub;

    return () => {
      unsub?.();
    };
  }, [protocol]);

  async function runCheck() {
    if (!protocol) return;
    setChecking(true);
    setFailures([]);
    await protocol.doPreArmCheck();
    // Wait a bit for STATUSTEXT messages to arrive
    setTimeout(() => {
      setChecking(false);
      setLastChecked(Date.now());
    }, 3000);
  }

  const allClear = failures.length === 0 && lastChecked !== null && !checking;

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
