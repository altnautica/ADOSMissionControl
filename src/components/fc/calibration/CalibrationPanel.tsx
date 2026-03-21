"use client";

import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import {
  ACCEL_STEPS, GYRO_STEPS, COMPASS_STEPS,
} from "./calibration-types";
import { CalibrationWizard } from "./CalibrationWizard";
import type { CompassProgressEntry, CompassResultEntry } from "./CalibrationWizard";
import { CalibrationRebootBanner } from "./CalibrationRebootBanner";
import { CalibrationLog } from "./CalibrationLog";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { useCalibrationEngine } from "./useCalibrationEngine";
import { CalibrationDiffTable } from "./CalibrationDiffTable";
import { CompassPreflightChecks } from "./CompassPreflightChecks";
import { PX4CalibrationsSection } from "./PX4CalibrationsSection";
import { ArduPilotCalibrations } from "./ArduPilotCalibrations";

export function CalibrationPanel() {
  const t = useTranslations("calibration");
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { firmwareType } = useFirmwareCapabilities();
  const isBetaflight = firmwareType === "betaflight";
  const connected = !!getSelectedProtocol();

  const cal = useCalibrationEngine();

  const compassProgressEntries: CompassProgressEntry[] = Array.from(cal.compass.compassProgress.entries())
    .map(([id, pct]) => ({
      compassId: id,
      completionPct: pct,
      calStatus: cal.compass.compassStatus.get(id) ?? 0,
      completionMask: cal.compass.compassCompletionMask.get(id) ?? [],
      direction: cal.compass.compassDirection.get(id) ?? { x: 0, y: 0, z: 0 },
    }));

  const compassResultEntries: CompassResultEntry[] = Array.from(cal.compass.compassResults.entries())
    .map(([id, r]) => ({ ...r, compassId: id }));

  return (
    <ArmedLockOverlay className="overflow-y-auto">
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* Left: Calibration Wizards */}
        <div className="space-y-6">
          <div>
            <h1 className="text-lg font-display font-semibold text-text-primary">{t("sensorCalibration")}</h1>
            <p className="text-xs text-text-tertiary mt-0.5">
              {t("sensorCalibrationDesc")}
            </p>
            {!connected && (
              <p className="text-[10px] text-status-warning mt-2">
                {t("connectToCalibrate")}
              </p>
            )}
          </div>

          {/* Betaflight: simplified calibration (accel only) */}
          {isBetaflight && (
            <>
              <CalibrationWizard
                title={t("bfAccelTitle")}
                description={t("bfAccelDesc")}
                steps={[{ label: t("calibrating"), description: t("bfAccelStepDesc") }]}
                currentStep={cal.accel.currentStep}
                status={cal.accel.status}
                progress={cal.accel.progress}
                statusMessage={cal.accel.message || (cal.accel.status === "in_progress" ? t("bfAccelInProgress") : undefined)}
                onStart={() => cal.startCalibration("accel", cal.setAccel, 1)}
                onCancel={() => cal.cancelCalibration("accel", cal.setAccel)}
              />
              <div className="border border-border-default bg-bg-secondary p-4 space-y-2">
                <h3 className="text-sm font-medium text-text-primary">{t("bfCalibrationTitle")}</h3>
                <p className="text-xs text-text-tertiary">
                  {t("bfCalibrationNote1")}
                </p>
                <p className="text-xs text-text-tertiary">
                  {t("bfCalibrationNote2")}
                </p>
              </div>
            </>
          )}

          {/* Accelerometer — 6-position (ArduPilot/PX4) */}
          {!isBetaflight && <CalibrationWizard
            title={t("accelCalibrationTitle")}
            description={t("accelCalibrationDesc")}
            steps={ACCEL_STEPS}
            currentStep={cal.accel.currentStep}
            status={cal.accel.status}
            progress={cal.accel.progress}
            statusMessage={cal.accel.message}
            waitingForConfirm={cal.accel.waitingForConfirm}
            onConfirm={cal.confirmAccelPosition}
            onStart={() => cal.startCalibration("accel", cal.setAccel, ACCEL_STEPS.length)}
            onCancel={() => cal.cancelCalibration("accel", cal.setAccel)}
          />}

          {/* Gyroscope */}
          {!isBetaflight && <CalibrationWizard
            title={t("gyroCalibrationTitle")}
            description={t("gyroCalibrationDesc")}
            steps={GYRO_STEPS}
            currentStep={cal.gyro.currentStep}
            status={cal.gyro.status}
            progress={cal.gyro.progress}
            statusMessage={cal.gyro.message}
            onStart={() => cal.startCalibration("gyro", cal.setGyro, GYRO_STEPS.length)}
            onCancel={() => cal.cancelCalibration("gyro", cal.setGyro)}
          />}

          {/* Compass pre-calibration checks (ArduPilot only) */}
          {!isBetaflight && connected && !cal.isPx4 && cal.compass.status === "idle" && (
            <CompassPreflightChecks
              compassParams={cal.compassParams}
              setCompassParams={cal.setCompassParams}
            />
          )}

          {/* Compass */}
          {!isBetaflight && <CalibrationWizard
            title={t("compassCalibrationTitle")}
            description={t("compassCalibrationDesc")}
            steps={COMPASS_STEPS}
            currentStep={cal.compass.currentStep}
            status={cal.compass.status}
            progress={cal.compass.progress}
            statusMessage={cal.compass.message}
            waitingForConfirm={cal.compass.waitingForConfirm}
            onConfirm={cal.acceptCompass}
            confirmLabel={t("acceptOffsets")}
            compassProgress={compassProgressEntries}
            compassResults={compassResultEntries}
            failureFixes={cal.compass.failureFixes}
            onForceSave={cal.forceCompassSave}
            preTips={[
              t("compassTip1"),
              t("compassTip2"),
              t("compassTip3"),
              t("compassTip4"),
            ]}
            onStart={() => cal.startCalibration("compass", cal.setCompass, COMPASS_STEPS.length)}
            onCancel={() => cal.cancelCalibration("compass", cal.setCompass)}
          />}

          {/* Compass Reboot Required Banner */}
          {!isBetaflight && cal.compass.needsReboot && cal.compass.status === "success" && (
            <CalibrationRebootBanner label={t("compassOffsetsSaved")} onReboot={() => { const p = getSelectedProtocol(); if (p) p.reboot(); }} />
          )}

          {/* Orientation change alert */}
          {!isBetaflight && cal.compass.status === "success" && compassResultEntries.some(
            (r) => r.oldOrientation !== r.newOrientation && r.newOrientation !== 0
          ) && (
            <div className="border border-status-warning/30 bg-status-warning/10 px-4 py-3">
              <p className="text-xs font-medium text-status-warning">{t("compassOrientationChanged")}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">
                {t("compassOrientationChangedDesc")}
              </p>
            </div>
          )}

          {/* Accel Reboot Banner */}
          {cal.accel.needsReboot && cal.accel.status === "success" && (
            <CalibrationRebootBanner label={t("accelCalibrationSaved")} onReboot={() => { const p = getSelectedProtocol(); if (p) p.reboot(); }} />
          )}

          {/* Level through CompassMot: ArduPilot/PX4 only */}
          {!isBetaflight && (
            <ArduPilotCalibrations
              connected={connected}
              level={cal.level} airspeed={cal.airspeed} baro={cal.baro}
              esc={cal.esc} compassmot={cal.compassmot} baroPressure={cal.baroPressure}
              startCalibration={cal.startCalibration} cancelCalibration={cal.cancelCalibration}
              setLevel={cal.setLevel} setAirspeed={cal.setAirspeed} setBaro={cal.setBaro}
              setEsc={cal.setEsc} setCompassmot={cal.setCompassmot}
            />
          )}

          {/* PX4-Only Calibrations */}
          {cal.isPx4 && (
            <PX4CalibrationsSection
              px4QuickLevel={cal.px4QuickLevel}
              px4GnssMagCal={cal.px4GnssMagCal}
              startPx4QuickLevel={cal.startPx4QuickLevel}
              startPx4GnssMagCal={cal.startPx4GnssMagCal}
              cancelCalibration={cal.cancelCalibration}
              setPx4QuickLevel={() => {}}
            />
          )}

          {/* Calibration Before/After Comparison */}
          {cal.calDiff && cal.calDiff.length > 0 && cal.calDiffType && (
            <CalibrationDiffTable
              calDiff={cal.calDiff}
              calDiffType={cal.calDiffType}
              onDismiss={() => { cal.setCalDiff(null); cal.setCalDiffType(null); }}
            />
          )}

          <div className="pb-4" />
        </div>

        {/* Right: Calibration Log */}
        <CalibrationLog logEntries={cal.logEntries} onClear={() => cal.setLogEntries([])} />
      </div>
    </div>
    </ArmedLockOverlay>
  );
}
