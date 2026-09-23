"use client";

import type { CalibrationState } from "./calibration-types";
import { LEVEL_STEPS } from "./calibration-types";
import { CalibrationWizard } from "./CalibrationWizard";
import { CalibrationRebootBanner } from "./CalibrationRebootBanner";
import { useDroneManager } from "@/stores/drone-manager";
import { Input } from "@/components/ui/input";
import { useState } from "react";

interface PX4CalibrationsSectionProps {
  px4QuickLevel: CalibrationState;
  px4GnssMagCal: CalibrationState;
  startPx4QuickLevel: () => void;
  startPx4GnssMagCal: (yawDeg: number) => void;
  cancelCalibration: (type: string, setter: React.Dispatch<React.SetStateAction<CalibrationState>>) => void;
  setPx4QuickLevel: React.Dispatch<React.SetStateAction<CalibrationState>>;
}

export function PX4CalibrationsSection({
  px4QuickLevel,
  px4GnssMagCal,
  startPx4QuickLevel,
  startPx4GnssMagCal,
  cancelCalibration,
  setPx4QuickLevel,
}: PX4CalibrationsSectionProps) {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  // The command calibrates against this yaw, so it is never defaulted: an
  // empty field is NaN and the protocol layer refuses it.
  const [yawText, setYawText] = useState("");
  const yawDeg = yawText.trim() === "" ? Number.NaN : Number(yawText);
  const yawInvalid = yawText.trim() !== "" && !(yawDeg >= 0 && yawDeg < 360);

  return (
    <>
      <div>
        <h2 className="text-sm font-display font-semibold text-text-primary mt-2 mb-1">PX4-Only Calibrations</h2>
        <p className="text-[10px] text-text-tertiary mb-4">
          Additional calibration options available on PX4 firmware
        </p>
      </div>

      {/* PX4 Quick Level */}
      <CalibrationWizard
        title="Quick Level (PX4)"
        description="Set level reference from current orientation. Place vehicle level before starting."
        steps={LEVEL_STEPS}
        currentStep={px4QuickLevel.currentStep}
        status={px4QuickLevel.status}
        progress={px4QuickLevel.progress}
        statusMessage={px4QuickLevel.message}
        onStart={startPx4QuickLevel}
        onCancel={() => cancelCalibration("level", setPx4QuickLevel)}
      />

      {/* PX4 Quick Level Reboot Banner */}
      {px4QuickLevel.needsReboot && px4QuickLevel.status === "success" && (
        <CalibrationRebootBanner label="Quick level calibration saved" onReboot={() => { const p = getSelectedProtocol(); if (p) p.reboot(); }} />
      )}

      {/* Known-heading (fixed yaw) compass calibration */}
      <div className="mb-2 max-w-[220px]">
        <Input
          id="fixed-yaw-mag-cal-heading"
          label="Vehicle heading (true, degrees)"
          type="number"
          min={0}
          max={359}
          step={1}
          unit="°"
          value={yawText}
          onChange={(e) => setYawText(e.target.value)}
          error={yawInvalid ? "Enter 0-359" : undefined}
        />
      </div>
      <CalibrationWizard
        title="Known-Heading Compass Calibration"
        description="Calibrate the compass from the world magnetic model and the heading the vehicle's nose points to. Requires a position fix. No rotation needed."
        steps={[{ label: "Heading", description: "Point the vehicle at a known heading and enter it above" }]}
        currentStep={px4GnssMagCal.currentStep}
        status={px4GnssMagCal.status}
        progress={px4GnssMagCal.progress}
        statusMessage={px4GnssMagCal.message}
        preTips={[
          "Ensure vehicle is outdoors with clear sky view",
          "Wait for good GPS fix (>6 satellites) before starting",
          "Point the vehicle nose at a known true heading and enter it above; a wrong heading miscalibrates the compass by the same error",
          "This calibration is quick and does not require rotation",
        ]}
        onStart={() => startPx4GnssMagCal(yawDeg)}
      />

      {/* GNSS Mag Cal Reboot Banner */}
      {px4GnssMagCal.needsReboot && px4GnssMagCal.status === "success" && (
        <CalibrationRebootBanner label="Compass calibration saved" onReboot={() => { const p = getSelectedProtocol(); if (p) p.reboot(); }} />
      )}

      {/* PX4 Thermal Calibration lives in its own panel */}
      <div className="mt-4 p-3 rounded-md bg-bg-tertiary border border-border-default">
        <div className="text-xs font-medium text-text-secondary">Thermal Calibration</div>
        <div className="text-[10px] text-text-tertiary">
          Configure and trigger thermal calibration from the Thermal Cal panel in the Sensors section. It runs on the next cold boot.
        </div>
      </div>
    </>
  );
}
