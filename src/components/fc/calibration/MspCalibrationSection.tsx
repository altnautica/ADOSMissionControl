"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { CalibrationWizard, type CalibrationStatus } from "./CalibrationWizard";
import { InavCalibration } from "./InavCalibration";
import { BF_ACC_CALIBRATION_MS, wait } from "./msp-calibration";

/**
 * Calibration for MSP flight controllers. Betaflight and iNav report no
 * calibration progress over MSP, so these surfaces never wait for STATUSTEXT
 * or treat a command reply as a finished calibration.
 */
export function MspCalibrationSection({ firmware }: { firmware: "betaflight" | "inav" }) {
  return firmware === "inav" ? <InavCalibration /> : <BetaflightAccelCalibration />;
}

function BetaflightAccelCalibration() {
  const t = useTranslations("calibration");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const [status, setStatus] = useState<CalibrationStatus>("idle");
  const [message, setMessage] = useState("");

  async function start() {
    const protocol = selectedProtocol;
    if (!protocol) return;
    setStatus("in_progress");
    setMessage(t("bfAccelInProgress"));
    const result = await protocol.startCalibration("accel");
    if (!result.success) {
      setStatus("error");
      setMessage(t("mspCommandRefused", { message: result.message }));
      return;
    }
    // Betaflight has no failure path once sampling starts: it averages its
    // samples, stores the trims and saves. It reports nothing when done.
    await wait(BF_ACC_CALIBRATION_MS);
    setStatus("success");
    setMessage(t("bfAccelDone"));
  }

  return (
    <>
      <CalibrationWizard
        title={t("bfAccelTitle")}
        description={t("bfAccelDesc")}
        steps={[{ label: t("calibrating"), description: t("bfAccelStepDesc") }]}
        currentStep={status === "success" ? 1 : 0}
        status={status}
        progress={status === "success" ? 100 : 0}
        statusMessage={message || undefined}
        onStart={start}
      />
      <div className="border border-border-default bg-bg-secondary p-4 space-y-2">
        <h3 className="text-sm font-medium text-text-primary">{t("bfCalibrationTitle")}</h3>
        <p className="text-xs text-text-tertiary">{t("bfCalibrationNote1")}</p>
        <p className="text-xs text-text-tertiary">{t("bfCalibrationNote2")}</p>
      </div>
    </>
  );
}
