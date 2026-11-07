"use client";

import { useTranslations } from "next-intl";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import {
  ACCEL_STEPS, GYRO_STEPS, COMPASS_STEPS,
} from "./calibration-types";
import { CalibrationWizard } from "./CalibrationWizard";
import type { CompassResultEntry } from "./CalibrationWizard";
import { compassProgressEntries } from "./compass-display";
import { CalibrationRebootBanner } from "./CalibrationRebootBanner";
import { CalibrationLog } from "./CalibrationLog";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { useCalibrationEngine } from "./useCalibrationEngine";
import { CalibrationDiffTable } from "./CalibrationDiffTable";
import { CompassPreflightChecks } from "./CompassPreflightChecks";
import { PX4CalibrationsSection } from "./PX4CalibrationsSection";
import { ArduPilotCalibrations } from "./ArduPilotCalibrations";
import { MspCalibrationSection } from "./MspCalibrationSection";
import { AgentSetupStep } from "./AgentSetupStep";
import { useAgentFcSetup } from "@/lib/fc-setup/use-fc-setup";

export function CalibrationPanel() {
  const t = useTranslations("calibration");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const { firmwareType } = useFirmwareCapabilities();
  // MSP firmwares get their own calibration surfaces; the ArduPilot/PX4
  // wizards below depend on MAVLink calibration feedback they never send.
  const mspFirmware = firmwareType === "betaflight" || firmwareType === "inav" ? firmwareType : null;
  const connected = !!selectedProtocol;

  const cal = useCalibrationEngine();
  // An agent-connected drone runs each calibration as one setup-engine step;
  // a direct-serial FC keeps the MAVLink wizards. MSP firmware never routes.
  const setup = useAgentFcSetup(mspFirmware ? null : selectedDroneId);

  const compassProgress = compassProgressEntries(cal.compass);

  const compassResultEntries: CompassResultEntry[] = Array.from(cal.compass.compassResults.entries())
    .map(([id, r]) => ({ ...r, compassId: id }));

  return (
    <ArmedWarningBanner className="overflow-y-auto">
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

          {/* Betaflight / iNav: MSP calibration surfaces */}
          {mspFirmware && <MspCalibrationSection firmware={mspFirmware} />}

          {/* Accelerometer — 6-position (ArduPilot/PX4) */}
          {!mspFirmware && <AgentSetupStep setup={setup} wizard="ground" step="accel"><CalibrationWizard
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
            blockedReason={cal.blockedReason}
            onCancel={() => cal.cancelCalibration("accel", cal.setAccel)}
          /></AgentSetupStep>}

          {/* Gyroscope */}
          {!mspFirmware && <AgentSetupStep setup={setup} wizard="ground" step="gyro"><CalibrationWizard
            title={t("gyroCalibrationTitle")}
            description={t("gyroCalibrationDesc")}
            steps={GYRO_STEPS}
            currentStep={cal.gyro.currentStep}
            status={cal.gyro.status}
            progress={cal.gyro.progress}
            statusMessage={cal.gyro.message}
            onStart={() => cal.startCalibration("gyro", cal.setGyro, GYRO_STEPS.length)}
            blockedReason={cal.blockedReason}
            onCancel={() => cal.cancelCalibration("gyro", cal.setGyro)}
          /></AgentSetupStep>}

          {/* Compass pre-calibration checks (ArduPilot only) */}
          {!mspFirmware && connected && !cal.isPx4 && cal.compass.status === "idle" && (
            <CompassPreflightChecks
              compassParams={cal.compassParams}
              setCompassParams={cal.setCompassParams}
            />
          )}

          {/* Compass */}
          {!mspFirmware && <AgentSetupStep setup={setup} wizard="ground" step="compass"><CalibrationWizard
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
            compassProgress={compassProgress}
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
            blockedReason={cal.blockedReason}
            onCancel={() => cal.cancelCalibration("compass", cal.setCompass)}
          /></AgentSetupStep>}

          {/* Compass Reboot Required Banner */}
          {!mspFirmware && cal.compass.needsReboot && cal.compass.status === "success" && (
            <CalibrationRebootBanner label={t("compassOffsetsSaved")} onReboot={() => { const p = selectedProtocol; if (p) p.reboot(); }} />
          )}

          {/* Orientation change alert */}
          {!mspFirmware && cal.compass.status === "success" && compassResultEntries.some(
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
          {!mspFirmware && cal.accel.needsReboot && cal.accel.status === "success" && (
            <CalibrationRebootBanner label={t("accelCalibrationSaved")} onReboot={() => { const p = selectedProtocol; if (p) p.reboot(); }} />
          )}

          {/* Level through CompassMot: ArduPilot/PX4 only */}
          {!mspFirmware && (
            <ArduPilotCalibrations
              connected={connected}
              setup={setup}
              blockedReason={cal.blockedReason}
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
              blockedReason={cal.blockedReason}
              px4GnssMagCal={cal.px4GnssMagCal}
              startPx4QuickLevel={cal.startPx4QuickLevel}
              startPx4GnssMagCal={cal.startPx4GnssMagCal}
              cancelCalibration={cal.cancelCalibration}
              setPx4QuickLevel={cal.setPx4QuickLevel}
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
    </ArmedWarningBanner>
  );
}
