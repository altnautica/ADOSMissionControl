"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { useInputStore } from "@/stores/input-store";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const JoystickCalibrationWizard = dynamic(
  () => import("./JoystickCalibrationWizard").then((m) => ({ default: m.JoystickCalibrationWizard })),
  { ssr: false }
);

const AXIS_LABEL_KEYS = ["roll", "pitch", "throttle", "yaw"] as const;

function AxisBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(-1, Math.min(1, value));
  const percent = ((clamped + 1) / 2) * 100;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary w-16 font-mono">{label}</span>
      <div className="flex-1 h-3 bg-bg-tertiary border border-border-default relative">
        {/* center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-default" />
        {/* value bar */}
        <div
          className="absolute top-0 bottom-0 bg-accent-primary/60 transition-all duration-75"
          style={{
            left: clamped >= 0 ? "50%" : `${percent}%`,
            width: `${Math.abs(clamped) * 50}%`,
          }}
        />
        {/* value indicator */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-accent-primary transition-all duration-75"
          style={{ left: `${percent}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-text-tertiary w-10 text-right tabular-nums">
        {clamped.toFixed(2)}
      </span>
    </div>
  );
}

export function ControllersSection() {
  const t = useTranslations("inputDevices");
  const { activeController, axes, deadzone, expo, setDeadzone, setExpo, calibration, clearCalibration } =
    useInputStore();
  const { toast } = useToast();
  const [showCalWizard, setShowCalWizard] = useState(false);

  const isConnected = activeController !== "none";

  const controllerLabel: Record<string, string> = {
    keyboard: t("keyboard"),
    gamepad: t("gamepadConnected"),
    rc_tx: t("rcTransmitter"),
    none: t("noController"),
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      {/* Detected Controllers */}
      <Card title={t("detectedControllers")}>
        <div className="flex items-center gap-2">
          <StatusDot status={isConnected ? "online" : "offline"} />
          <span
            className={cn(
              "text-xs",
              isConnected ? "text-status-success" : "text-text-tertiary"
            )}
          >
            {controllerLabel[activeController]}
          </span>
        </div>
      </Card>

      {/* Calibration */}
      {isConnected && (
        <Card title="Calibration">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {calibration ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-status-success/15 text-status-success">
                  Calibrated
                </span>
              ) : (
                <span className="text-xs text-text-tertiary">Not calibrated</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {calibration && (
                <button
                  onClick={clearCalibration}
                  className="text-[10px] text-text-tertiary hover:text-status-error transition-colors"
                >
                  Reset
                </button>
              )}
              <button
                onClick={() => setShowCalWizard(true)}
                className="px-3 py-1 text-xs font-medium bg-accent-primary text-white rounded hover:opacity-90 transition-opacity"
              >
                {calibration ? "Recalibrate" : "Calibrate"}
              </button>
            </div>
          </div>
        </Card>
      )}

      {showCalWizard && (
        <JoystickCalibrationWizard onClose={() => setShowCalWizard(false)} />
      )}

      {/* Axis Mapping */}
      <Card title={t("axisMapping")}>
        <div className="space-y-3">
          {AXIS_LABEL_KEYS.map((labelKey, i) => (
            <AxisBar key={labelKey} label={t(labelKey)} value={axes[i]} />
          ))}
        </div>
      </Card>

      {/* Deadzone & Expo */}
      <Card title={t("tuning")}>
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-text-secondary">{t("deadzone")}</label>
              <span className="text-[10px] font-mono text-text-tertiary tabular-nums">
                {deadzone.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.01}
              max={0.2}
              step={0.01}
              value={deadzone}
              onChange={(e) => setDeadzone(parseFloat(e.target.value))}
              className="w-full h-1 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary"
            />
            <div className="flex justify-between text-[9px] text-text-tertiary font-mono">
              <span>0.01</span>
              <span>0.20</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-text-secondary">{t("expoCurve")}</label>
              <span className="text-[10px] font-mono text-text-tertiary tabular-nums">
                {expo.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={expo}
              onChange={(e) => setExpo(parseFloat(e.target.value))}
              className="w-full h-1 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary"
            />
            <div className="flex justify-between text-[9px] text-text-tertiary font-mono">
              <span>0.0</span>
              <span>1.0</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Test Mode */}
      <Button
        variant="secondary"
        onClick={() => toast(t("testModeUnavailable"), "info")}
      >
        {t("testMode")}
      </Button>
    </div>
  );
}
