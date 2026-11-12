"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useSensorHealth } from "@/hooks/use-sensor-health";
import { SensorHealthGrid } from "@/components/indicators/SensorHealthGrid";
import { EkfStatusBars } from "@/components/indicators/EkfStatusBars";
import { VibrationGauges } from "@/components/indicators/VibrationGauges";
import { GpsSkyView } from "@/components/indicators/GpsSkyView";
import { PreArmChecks } from "@/components/indicators/PreArmChecks";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockStore } from "@/stores/clock-store";
import { getFreshness, useClockTick } from "@/lib/agent/freshness";
import { isFresh } from "@/lib/telemetry/freshness";
import { decodeArmingFlags } from "@/lib/protocol/msp/inav-arming-flags";
import { decodeBetaflightArmingFlags } from "@/lib/protocol/msp/betaflight-arming-flags";
import {
  Activity,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FcSection } from "@/components/fc/shared/FcSection";

// ── Component ────────────────────────────────────────────────

export function PreArmPanel() {
  const tk = useTranslations("fcPanels.preArmPanel");
  const { healthyCount, presentCount: totalPresent } = useSensorHealth();
  const protocol = useDroneManager(selectSelectedProtocol);
  const firmwareType = protocol?.getVehicleInfo()?.firmwareType;

  // Arming flags come from the connected MSP firmware. The word means different
  // things on Betaflight vs iNav, so pick the decoder by the identified
  // firmware; only one MSP FC is connected at a time, so the raw word is
  // unambiguous once we know which firmware produced it.
  const armingFirmware =
    firmwareType === "betaflight"
      ? "betaflight"
      : firmwareType === "inav"
        ? "inav"
        : null;
  const armingFlags = useTelemetryStore((s) => s.armingFlags);
  const armingFlagCount = useTelemetryStore((s) => s.armingFlagCount);
  const armingFlagsAt = useTelemetryStore((s) => s.armingFlagsUpdatedAt);
  // The word is a scalar that keeps its last value when MSP status stops, so
  // the verdict is shown only while it is current; re-evaluated on the shared
  // 1 Hz clock so a dropped link turns the badge stale instead of holding
  // "OK TO ARM".
  useClockTick();
  const now = useClockStore((s) => s.now);
  const flagsLive = armingFlagsAt > 0 && isFresh(armingFlagsAt, now);
  const decodedFlags =
    armingFlags === null || armingFirmware === null
      ? null
      : armingFirmware === "betaflight"
        ? decodeBetaflightArmingFlags(armingFlags, armingFlagCount ?? undefined)
        : decodeArmingFlags(armingFlags);

  const [showAllSensors, setShowAllSensors] = useState(false);
  const [showArmingBlockers, setShowArmingBlockers] = useState(true);

  // Request SYS_STATUS at higher rate on mount for faster health data
  useEffect(() => {
    if (!protocol) return;
    // SYS_STATUS = message ID 1, request at 2 Hz (500000 us interval)
    if (protocol.setMessageInterval) {
      protocol.setMessageInterval(1, 500_000).catch(() => {
        // Silently fail. Not all firmware supports this
      });
    }
    return () => {
      // Restore default rate on unmount (0 = default rate)
      if (protocol.setMessageInterval) {
        protocol.setMessageInterval(1, 0).catch(() => {});
      }
    };
  }, [protocol]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-display font-semibold text-text-primary">{tk("healthCheck")}</h1>
            <p className="text-xs text-text-tertiary mt-0.5">
              {tk("sensorStatusEKFVibrationGPS")}
            </p>
          </div>
        </div>

        {/* Sensor Status */}
        <FcSection icon={<Activity size={14} />} title={tk("sensorStatus")} description={`${healthyCount}/${totalPresent} sensors healthy`}>
          <SensorHealthGrid showAll={showAllSensors} />
          <button
            onClick={() => setShowAllSensors(!showAllSensors)}
            className="text-[10px] text-accent-primary hover:underline mt-1"
          >
            {showAllSensors ? "Show present only" : "Show all 32 sensor bits"}
          </button>
        </FcSection>

        {/* EKF Status */}
        <FcSection icon={<Activity size={14} />} title={tk("ekfStatus")} description={tk("extendedKalmanFilterVariance")}>
          <EkfStatusBars />
        </FcSection>

        {/* Vibration */}
        <FcSection icon={<Activity size={14} />} title={tk("vibration")} description={tk("accelerometerVibrationLevelsMS")}>
          <VibrationGauges />
        </FcSection>

        {/* GPS */}
        <FcSection icon={<Activity size={14} />} title="GPS" description={tk("positionFixAndSatelliteInfo")}>
          <GpsSkyView />
        </FcSection>

        {/* Pre-Arm Checks */}
        <FcSection icon={<ShieldCheck size={14} />} title={tk("preArmChecks")} description={tk("flightReadinessVerification")}>
          <PreArmChecks />
        </FcSection>

        {/* MSP arming flags. Shown for Betaflight and iNav (each decoded with
            its own flag map). */}
        {armingFirmware !== null && decodedFlags !== null && (
          <div className="border border-border-default bg-bg-secondary p-4">
            <button
              onClick={() => setShowArmingBlockers((v) => !v)}
              className="flex items-center gap-2 w-full text-left"
            >
              <span className="text-accent-primary">
                <ShieldCheck size={14} />
              </span>
              <div className="flex-1">
                <h2 className="text-sm font-medium text-text-primary">
                  {armingFirmware === "betaflight" ? "Betaflight" : "iNav"} Arming Flags
                </h2>
                <p className="text-[10px] text-text-tertiary">
                  {!flagsLive
                    ? `No current arming status from the FC (last received ${getFreshness(armingFlagsAt).label})`
                    : decodedFlags.okToArm
                      ? "Ready to arm"
                      : `${decodedFlags.blockers.length} blocker${decodedFlags.blockers.length !== 1 ? "s" : ""} preventing arming`}
                </p>
              </div>
              <span className={cn(
                "text-[10px] font-mono px-1.5 py-0.5 shrink-0",
                !flagsLive
                  ? "bg-bg-tertiary text-text-tertiary"
                  : decodedFlags.okToArm
                    ? "bg-status-success/10 text-status-success"
                    : "bg-status-error/10 text-status-error"
              )}>
                {!flagsLive ? "STALE" : decodedFlags.okToArm ? "OK TO ARM" : "BLOCKED"}
              </span>
              {showArmingBlockers ? <ChevronDown size={12} className="text-text-tertiary shrink-0" /> : <ChevronRight size={12} className="text-text-tertiary shrink-0" />}
            </button>

            {showArmingBlockers && flagsLive && (
              <div className="mt-3 space-y-2">
                {decodedFlags.blockers.length > 0 && (
                  <div>
                    <p className="text-[9px] text-text-tertiary uppercase tracking-wider mb-1">{tk("blockers")}</p>
                    <ul className="space-y-0.5">
                      {decodedFlags.blockers.map((b) => (
                        <li key={b} className="flex items-center gap-1.5 text-[11px] text-status-error">
                          <span className="w-1.5 h-1.5 rounded-full bg-status-error shrink-0" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {decodedFlags.notes.length > 0 && (
                  <div>
                    <p className="text-[9px] text-text-tertiary uppercase tracking-wider mb-1">{tk("notes")}</p>
                    <ul className="space-y-0.5">
                      {decodedFlags.notes.map((n) => (
                        <li key={n} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                          <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary shrink-0" />
                          {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {decodedFlags.blockers.length === 0 && decodedFlags.notes.length === 0 && (
                  <p className="text-[11px] text-text-tertiary">{tk("noActiveFlags")}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
