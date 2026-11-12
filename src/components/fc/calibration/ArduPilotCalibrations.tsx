"use client";

import { useOptionLabels } from "@/lib/i18n/option-labels";
import { useTranslations } from "next-intl";
import { CalibrationWizard } from "./CalibrationWizard";
import { CalibrationRebootBanner } from "./CalibrationRebootBanner";
import { RcCalibrationWizard } from "./RcCalibrationWizard";
import { RcChannelMapSection } from "../receiver/RcChannelMapSection";
import { GpsConfigSection } from "../sensors/GpsConfigSection";
import { ServoCalibrationSection } from "../misc/ServoCalibrationSection";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import {
  LEVEL_STEPS, AIRSPEED_STEPS, BARO_STEPS, ESC_CAL_STEPS, COMPASSMOT_STEPS,
} from "./calibration-types";
import type { CalibrationState } from "./calibration-types";
import { AgentSetupStep } from "./AgentSetupStep";
import { setupText } from "@/lib/fc-setup/strings";
import type { FcSetupController } from "@/lib/fc-setup/use-fc-setup";

interface Props {
  connected: boolean;
  /** The drone's agent setup engine; null keeps the MAVLink wizards. */
  setup: FcSetupController | null;
  /** Set while a calibration may not start (vehicle armed or arm state unknown). */
  blockedReason?: string;
  level: CalibrationState;
  airspeed: CalibrationState;
  baro: CalibrationState;
  esc: CalibrationState;
  compassmot: CalibrationState;
  baroPressure: { pressAbs: number; temperature: number } | null;
  startCalibration: (type: "accel" | "gyro" | "compass" | "level" | "airspeed" | "baro" | "rc" | "esc" | "compassmot", setter: React.Dispatch<React.SetStateAction<CalibrationState>>, stepCount: number) => void;
  cancelCalibration: (type: string, setter: React.Dispatch<React.SetStateAction<CalibrationState>>) => void;
  setLevel: React.Dispatch<React.SetStateAction<CalibrationState>>;
  setAirspeed: React.Dispatch<React.SetStateAction<CalibrationState>>;
  setBaro: React.Dispatch<React.SetStateAction<CalibrationState>>;
  setEsc: React.Dispatch<React.SetStateAction<CalibrationState>>;
  setCompassmot: React.Dispatch<React.SetStateAction<CalibrationState>>;
}

export function ArduPilotCalibrations({
  connected, setup, blockedReason, level, airspeed, baro, esc, compassmot, baroPressure,
  startCalibration, cancelCalibration,
  setLevel, setAirspeed, setBaro, setEsc, setCompassmot,
}: Props) {
  const ol = useOptionLabels();
  const tr = useTranslations("fcPanels.arduPilotCalibrations");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);

  return (
    <>
      <AgentSetupStep setup={setup} wizard="ground" step="level"><CalibrationWizard
        title={setupText("setup.level.title")}
        description={tr("setTheReferenceLevelHorizon")}
        steps={ol(LEVEL_STEPS)}
        currentStep={level.currentStep}
        status={level.status}
        progress={level.progress}
        statusMessage={level.message}
        onStart={() => startCalibration("level", setLevel, LEVEL_STEPS.length)}
        blockedReason={blockedReason}
        onCancel={() => cancelCalibration("level", setLevel)}
      /></AgentSetupStep>

      {level.needsReboot && level.status === "success" && (
        <CalibrationRebootBanner label={tr("levelCalibrationSaved")} onReboot={() => { const p = selectedProtocol; if (p) p.reboot(); }} />
      )}

      <AgentSetupStep setup={setup} wizard="ground" step="airspeed"><CalibrationWizard
        title={tr("airspeedCalibration")}
        description={tr("arduplaneOnlyCoverThePitot")}
        steps={ol(AIRSPEED_STEPS)}
        currentStep={airspeed.currentStep}
        status={airspeed.status}
        progress={airspeed.progress}
        statusMessage={airspeed.message}
        onStart={() => startCalibration("airspeed", setAirspeed, AIRSPEED_STEPS.length)}
        blockedReason={blockedReason}
        onCancel={() => cancelCalibration("airspeed", setAirspeed)}
      /></AgentSetupStep>

      <CalibrationWizard
        title={tr("barometerCalibration")}
        description={tr("resetsGroundPressureReferenceKeep")}
        steps={ol(BARO_STEPS)}
        currentStep={baro.currentStep}
        status={baro.status}
        progress={baro.progress}
        statusMessage={baro.message}
        onStart={() => startCalibration("baro", setBaro, BARO_STEPS.length)}
        blockedReason={blockedReason}
        onCancel={() => cancelCalibration("baro", setBaro)}
      />

      {/* Baro live pressure readout */}
      {connected && baroPressure && (
        <div className="border border-border-default bg-bg-secondary px-4 py-2.5 -mt-4">
          <div className="flex items-center gap-4 text-[10px] font-mono">
            <span className="text-text-secondary">{tr("pressure")}</span>
            <span className="text-text-primary">{baroPressure.pressAbs.toFixed(2)} hPa</span>
            <span className="text-text-secondary">{tr("temp")}</span>
            <span className="text-text-primary">{baroPressure.temperature.toFixed(1)} °C</span>
          </div>
        </div>
      )}

      <AgentSetupStep setup={setup} wizard="ground" step="radio"><RcCalibrationWizard connected={connected} /></AgentSetupStep>
      <RcChannelMapSection />
      <GpsConfigSection />
      <ServoCalibrationSection />

      <CalibrationWizard
        title={tr("escCalibration")}
        description={tr("setESCThrottleEndpointsREMOVE")}
        steps={ol(ESC_CAL_STEPS)}
        currentStep={esc.currentStep}
        status={esc.status}
        progress={esc.progress}
        statusMessage={esc.message}
        preTips={[
          "CRITICAL: Remove ALL propellers before starting",
          "Disconnect battery before beginning the sequence",
          "Some ESCs require this calibration on first use",
          "If using BLHeli/SimonK ESCs, use their own calibration tools instead",
          "This runs as a physical throttle passthrough on reboot and does not report a completion over MAVLink — follow the ESC beep sequence; the wizard ending on a timeout is expected.",
        ]}
        onStart={() => startCalibration("esc", setEsc, ESC_CAL_STEPS.length)}
        blockedReason={blockedReason}
        onCancel={() => cancelCalibration("esc", setEsc)}
      />

      {esc.needsReboot && esc.status === "success" && (
        <CalibrationRebootBanner label={tr("escCalibrationSaved")} onReboot={() => { const p = selectedProtocol; if (p) p.reboot(); }} />
      )}

      <CalibrationWizard
        title={tr("compassmotMotorInterference")}
        description={tr("measuresMagneticInterferenceFromMotors")}
        steps={ol(COMPASSMOT_STEPS)}
        currentStep={compassmot.currentStep}
        status={compassmot.status}
        progress={compassmot.progress}
        statusMessage={compassmot.message}
        preTips={[
          "Ensure GPS has 3D fix before starting",
          "Vehicle must be in open area away from metal objects",
          "Props ON — motors WILL spin during this test",
          "Interference below 30% is acceptable, below 15% is good",
        ]}
        onStart={() => startCalibration("compassmot", setCompassmot, COMPASSMOT_STEPS.length)}
        blockedReason={blockedReason}
        onCancel={() => cancelCalibration("compassmot", setCompassmot)}
      />

      {compassmot.needsReboot && compassmot.status === "success" && (
        <CalibrationRebootBanner label={tr("compassmotCalibrationSaved")} onReboot={() => { const p = selectedProtocol; if (p) p.reboot(); }} />
      )}
    </>
  );
}
