"use client";

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

interface Props {
  connected: boolean;
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
  connected, level, airspeed, baro, esc, compassmot, baroPressure,
  startCalibration, cancelCalibration,
  setLevel, setAirspeed, setBaro, setEsc, setCompassmot,
}: Props) {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);

  return (
    <>
      <CalibrationWizard
        title="Level Calibration"
        description="Set the reference level horizon for the flight controller."
        steps={LEVEL_STEPS}
        currentStep={level.currentStep}
        status={level.status}
        progress={level.progress}
        statusMessage={level.message}
        onStart={() => startCalibration("level", setLevel, LEVEL_STEPS.length)}
        onCancel={() => cancelCalibration("level", setLevel)}
      />

      {level.needsReboot && level.status === "success" && (
        <CalibrationRebootBanner label="Level calibration saved" onReboot={() => { const p = selectedProtocol; if (p) p.reboot(); }} />
      )}

      <CalibrationWizard
        title="Airspeed Calibration"
        description="ArduPlane only — cover the pitot tube opening before starting."
        steps={AIRSPEED_STEPS}
        currentStep={airspeed.currentStep}
        status={airspeed.status}
        progress={airspeed.progress}
        statusMessage={airspeed.message}
        onStart={() => startCalibration("airspeed", setAirspeed, AIRSPEED_STEPS.length)}
        onCancel={() => cancelCalibration("airspeed", setAirspeed)}
      />

      <CalibrationWizard
        title="Barometer Calibration"
        description="Resets ground pressure reference. Keep vehicle still during calibration."
        steps={BARO_STEPS}
        currentStep={baro.currentStep}
        status={baro.status}
        progress={baro.progress}
        statusMessage={baro.message}
        onStart={() => startCalibration("baro", setBaro, BARO_STEPS.length)}
        onCancel={() => cancelCalibration("baro", setBaro)}
      />

      {/* Baro live pressure readout */}
      {connected && baroPressure && (
        <div className="border border-border-default bg-bg-secondary px-4 py-2.5 -mt-4">
          <div className="flex items-center gap-4 text-[10px] font-mono">
            <span className="text-text-secondary">Pressure</span>
            <span className="text-text-primary">{baroPressure.pressAbs.toFixed(2)} hPa</span>
            <span className="text-text-secondary">Temp</span>
            <span className="text-text-primary">{baroPressure.temperature.toFixed(1)} °C</span>
          </div>
        </div>
      )}

      <RcCalibrationWizard connected={connected} />
      <RcChannelMapSection />
      <GpsConfigSection />
      <ServoCalibrationSection />

      <CalibrationWizard
        title="ESC Calibration"
        description="Set ESC throttle endpoints. REMOVE ALL PROPELLERS before starting."
        steps={ESC_CAL_STEPS}
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
        onCancel={() => cancelCalibration("esc", setEsc)}
      />

      {esc.needsReboot && esc.status === "success" && (
        <CalibrationRebootBanner label="ESC calibration saved" onReboot={() => { const p = selectedProtocol; if (p) p.reboot(); }} />
      )}

      <CalibrationWizard
        title="CompassMot (Motor Interference)"
        description="Measures magnetic interference from motors/ESCs at various throttle levels. Compensates compass readings."
        steps={COMPASSMOT_STEPS}
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
        onCancel={() => cancelCalibration("compassmot", setCompassmot)}
      />

      {compassmot.needsReboot && compassmot.status === "success" && (
        <CalibrationRebootBanner label="CompassMot calibration saved" onReboot={() => { const p = selectedProtocol; if (p) p.reboot(); }} />
      )}
    </>
  );
}
