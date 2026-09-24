"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, Circle } from "lucide-react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { Button } from "@/components/ui/button";
import { cn, formatErrorMessage } from "@/lib/utils";
import {
  INAV_ACC_ALL_POSITIONS,
  INAV_ACC_CAPTURE_MS,
  INAV_MAG_CAL_DEFAULT_S,
  countPositions,
  inavAccelCaptureOutcome,
  wait,
} from "./msp-calibration";

type Tone = "info" | "success" | "error";

function Note({ tone, text }: { tone: Tone; text: string }) {
  return (
    <p
      className={cn(
        "text-xs",
        tone === "success" && "text-status-success",
        tone === "error" && "text-status-error",
        tone === "info" && "text-text-secondary",
      )}
    >
      {text}
    </p>
  );
}

function PositionTile({ done, label }: { done: boolean; label: string }) {
  return (
    <div className={cn("flex items-center gap-2 border px-3 py-2 text-xs", done ? "border-status-success/40 text-status-success" : "border-border-default text-text-tertiary")}>
      {done ? <CheckCircle size={12} /> : <Circle size={12} />}
      {label}
    </div>
  );
}

const fmtOffsets = (v: [number, number, number]) => `(${v.join(", ")})`;

export function InavCalibration() {
  const t = useTranslations("calibration");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);

  const [flags, setFlags] = useState<number | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [accBusy, setAccBusy] = useState(false);
  const [accNote, setAccNote] = useState<{ tone: Tone; text: string } | null>(null);
  const [magLeft, setMagLeft] = useState<number | null>(null);
  const [magNote, setMagNote] = useState<{ tone: Tone; text: string } | null>(null);

  const readFlags = useCallback(async (): Promise<number | null> => {
    const protocol = selectedProtocol;
    if (!protocol?.getCalibrationData) return null;
    try {
      const data = await protocol.getCalibrationData();
      setFlags(data.accPositionFlags);
      setReadError(null);
      return data.accPositionFlags;
    } catch (err) {
      setReadError(t("inavReadFailed", { message: formatErrorMessage(err) }));
      return null;
    }
  }, [selectedProtocol, t]);

  useEffect(() => {
    const protocol = selectedProtocol;
    if (!protocol?.getCalibrationData) return;
    let live = true;
    protocol.getCalibrationData().then(
      (data) => { if (live) setFlags(data.accPositionFlags); },
      (err: unknown) => { if (live) setReadError(t("inavReadFailed", { message: formatErrorMessage(err) })); },
    );
    return () => { live = false; };
  }, [selectedProtocol, t]);

  async function captureOrientation() {
    const protocol = selectedProtocol;
    if (!protocol || flags === null) return;
    setAccBusy(true);
    setAccNote(null);
    const before = flags;
    const result = await protocol.startCalibration("accel");
    if (!result.success) {
      setAccNote({ tone: "error", text: t("mspCommandRefused", { message: result.message }) });
      setAccBusy(false);
      return;
    }
    await wait(INAV_ACC_CAPTURE_MS);
    const after = await readFlags();
    setAccBusy(false);
    if (after === null) return;
    const outcome = inavAccelCaptureOutcome(before, after);
    setAccNote(
      outcome === "complete" ? { tone: "success", text: t("inavAccelComplete") }
        : outcome === "rejected" ? { tone: "error", text: t("inavAccelRejected") }
          : outcome === "captured" ? { tone: "info", text: t("inavAccelCaptured") }
            : { tone: "error", text: t("inavAccelNotCaptured") },
    );
  }

  async function calibrateCompass() {
    const protocol = selectedProtocol;
    if (!protocol?.getCalibrationData) return;
    setMagNote(null);
    let seconds = INAV_MAG_CAL_DEFAULT_S;
    let timeKnown = false;
    try {
      const setting = await protocol.settings?.getSetting("mag_calibration_time");
      if (setting && typeof setting.value === "number") { seconds = setting.value; timeKnown = true; }
    } catch { /* the default applies; the note says so */ }
    let before: [number, number, number];
    try {
      before = (await protocol.getCalibrationData()).magZero;
    } catch (err) {
      setMagNote({ tone: "error", text: t("inavReadFailed", { message: formatErrorMessage(err) }) });
      return;
    }
    const result = await protocol.startCalibration("compass");
    if (!result.success) {
      setMagNote({ tone: "error", text: t("mspCommandRefused", { message: result.message }) });
      return;
    }
    if (!timeKnown) setMagNote({ tone: "info", text: t("inavCompassTimeUnknown", { seconds }) });
    for (let left = seconds; left > 0; left--) {
      setMagLeft(left);
      await wait(1000);
    }
    setMagLeft(null);
    // iNav stores the offsets when its calibration time runs out.
    await wait(1000);
    try {
      const after = (await protocol.getCalibrationData()).magZero;
      const changed = after.some((v, i) => v !== before[i]);
      setMagNote(changed
        ? { tone: "success", text: t("inavCompassUpdated", { before: fmtOffsets(before), after: fmtOffsets(after) }) }
        : { tone: "error", text: t("inavCompassUnchanged", { after: fmtOffsets(after) }) });
    } catch (err) {
      setMagNote({ tone: "error", text: t("inavReadFailed", { message: formatErrorMessage(err) }) });
    }
  }

  const has = (bit: number) => flags !== null && (flags & (1 << bit)) !== 0;
  const sides = flags === null ? 0 : countPositions(flags & 0b111100);

  return (
    <>
      <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
        <h3 className="text-sm font-medium text-text-primary">{t("inavAccelTitle")}</h3>
        <p className="text-xs text-text-tertiary">{t("inavAccelDesc")}</p>
        {readError && <Note tone="error" text={readError} />}
        {flags !== null && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <PositionTile done={has(0)} label={t("inavPosTop")} />
              <PositionTile done={has(1)} label={t("inavPosBottom")} />
              <PositionTile done={sides === 4} label={t("inavPosSides", { count: sides })} />
            </div>
            <p className="text-xs text-text-secondary">
              {flags === INAV_ACC_ALL_POSITIONS ? t("inavAccelCalibrated") : t("inavAccelProgress", { count: countPositions(flags) })}
            </p>
          </>
        )}
        {accNote && <Note tone={accNote.tone} text={accNote.text} />}
        <Button size="sm" variant="primary" loading={accBusy} disabled={accBusy || flags === null} onClick={captureOrientation}>
          {t("inavAccelCapture")}
        </Button>
      </div>

      <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
        <h3 className="text-sm font-medium text-text-primary">{t("inavCompassTitle")}</h3>
        <p className="text-xs text-text-tertiary">{t("inavCompassDesc")}</p>
        {magLeft !== null && <Note tone="info" text={t("inavCompassRunning", { seconds: magLeft })} />}
        {magNote && <Note tone={magNote.tone} text={magNote.text} />}
        <Button size="sm" variant="primary" disabled={magLeft !== null || flags === null} onClick={calibrateCompass}>
          {t("inavCompassStart")}
        </Button>
      </div>

      <div className="border border-border-default bg-bg-secondary p-4 space-y-2">
        <h3 className="text-sm font-medium text-text-primary">{t("inavLevelTitle")}</h3>
        <p className="text-xs text-text-tertiary">{t("inavLevelNote")}</p>
        <p className="text-xs text-text-tertiary">{t("inavGyroNote")}</p>
      </div>
    </>
  );
}
