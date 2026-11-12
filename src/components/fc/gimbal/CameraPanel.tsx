"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useFcPanelState } from "@/hooks/use-fc-panel-state";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useToast } from "@/components/ui/toast";
import { usePanelCommit } from "@/hooks/use-panel-commit";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Camera, Save, Aperture, Ruler, Calculator, Timer } from "lucide-react";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import {
  CAMERA_PARAMS, OPTIONAL_CAMERA_PARAMS, CAM_TYPE_OPTIONS, PX4_TRIG_MODE_OPTIONS,
} from "./camera-constants";
import { withCurrent as withCurrentOption } from "../frame/enum-options";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

export function CameraPanel() {
  const tr = useTranslations("fcPanels.cameraPanel");
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, getProtocol,
    refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = useFcPanelState({ paramNames: CAMERA_PARAMS, optionalParams: OPTIONAL_CAMERA_PARAMS, panelId: "camera" });
  const { toast } = useToast();
  const t = useTranslations("fcToasts.gimbal");
  const { saving, save: handleSave, flashing, flash: handleFlash } = usePanelCommit({ saveAllToRam, commitToFlash, revertAll });
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;
  const [imageCount, setImageCount] = useState(0);
  const [intervalSec, setIntervalSec] = useState(5);
  const [intervalActive, setIntervalActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Survey helper state
  const [surveyAlt, setSurveyAlt] = useState(50);
  const [surveyFov, setSurveyFov] = useState(84);
  const [surveyOverlap, setSurveyOverlap] = useState(70);

  const connected = !!getProtocol();
  const hasDirty = dirtyParams.size > 0;
  // CAM1_TYPE is ArduPilot's camera type; on PX4 the handler maps it to
  // TRIG_MODE, whose 0 is likewise "disabled".
  const camEnabled = (params.get("CAM1_TYPE") ?? 0) !== 0;
  // ArduPilot type 1 is a servo shutter. PX4's PWM trigger values are shown
  // whenever the vehicle reports them.
  const showServo = isPx4
    ? params.has("CAM1_SERVO_ON") || params.has("CAM1_SERVO_OFF")
    : params.get("CAM1_TYPE") === 1;
  const typeOptions = withCurrentOption(
    isPx4 ? PX4_TRIG_MODE_OPTIONS : CAM_TYPE_OPTIONS,
    params.get("CAM1_TYPE"),
  );

  const p = (name: string) => String(params.get(name) ?? "");
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  const calculatedTriggerDist = useMemo(() => {
    if (surveyAlt <= 0 || surveyFov <= 0 || surveyOverlap <= 0) return 0;
    const footprint = 2 * surveyAlt * Math.tan((surveyFov / 2) * Math.PI / 180);
    return footprint * (1 - surveyOverlap / 100);
  }, [surveyAlt, surveyFov, surveyOverlap]);

  async function handleTrigger() {
    const protocol = getProtocol();
    if (!protocol) return;
    const result = await protocol.cameraTrigger();
    if (result.success) {
      setImageCount((c) => c + 1);
      toast(t("cameraTriggered"), "success");
    } else {
      toast(result.message || t("cameraTriggerRefused"), "error");
    }
  }

  function applyCalculatedDistance() {
    if (calculatedTriggerDist > 0) {
      set("CAM1_TRIGG_DIST", calculatedTriggerDist.toFixed(1));
      toast(t("triggerDistanceSet", { distance: calculatedTriggerDist.toFixed(1) }), "success");
    }
  }

  // Counts only the captures the vehicle acknowledged.
  const doIntervalTrigger = useCallback(async () => {
    const protocol = getProtocol();
    if (!protocol) return;
    const result = await protocol.cameraTrigger();
    if (result.success) setImageCount((c) => c + 1);
  }, [getProtocol]);

  function toggleIntervalTrigger() {
    if (intervalActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      setIntervalActive(false);
      toast(t("intervalStopped"), "success");
    } else {
      if (intervalSec <= 0) {
        toast(t("intervalInvalid"), "warning");
        return;
      }
      void doIntervalTrigger();
      intervalRef.current = setInterval(() => void doIntervalTrigger(), intervalSec * 1000);
      setIntervalActive(true);
      toast(t("intervalStarted", { seconds: intervalSec }), "success");
    }
  }

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <ArmedWarningBanner>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title={tr("camera")}
            subtitle={tr("cameraTriggerServoSettingsDistance")}
            icon={<Camera size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          {isPx4 && (
            <p className="text-xs text-text-tertiary mb-3">
              PX4 uses TRIG_* parameters for camera trigger. Parameters mapped automatically.
            </p>
          )}

          {/* Camera Type */}
          <FcSection icon={<Camera size={14} />} title={tr("cameraConfiguration")} description={tr("cameraTypeAndTriggerMethod")}>
            <Select
              label={lbl(isPx4 ? "CAM1_TYPE — Trigger Mode" : "CAM1_TYPE — Camera Type")}
              options={typeOptions}
              value={p("CAM1_TYPE")}
              onChange={(v) => set("CAM1_TYPE", v)}
            />
          </FcSection>

          {/* Servo Trigger Settings */}
          {camEnabled && showServo && (
            <FcSection icon={<Aperture size={14} />} title={tr("servoTrigger")} description={tr("pwmValuesForServoBased")}>
              {params.has("CAM1_SERVO_OFF") && (
                <Input
                  label={lbl(`CAM1_SERVO_OFF — ${tr("servoOffPWM")}`)}
                  type="number"
                  step="10"
                  min="500"
                  max="2500"
                  unit="μs"
                  value={p("CAM1_SERVO_OFF")}
                  onChange={(e) => set("CAM1_SERVO_OFF", e.target.value)}
                />
              )}
              {params.has("CAM1_SERVO_ON") && (
                <Input
                  label={lbl(`CAM1_SERVO_ON — ${tr("servoOnPWM")}`)}
                  type="number"
                  step="10"
                  min="500"
                  max="2500"
                  unit="μs"
                  value={p("CAM1_SERVO_ON")}
                  onChange={(e) => set("CAM1_SERVO_ON", e.target.value)}
                />
              )}
              {params.has("CAM1_DURATION") && (
                // ArduPilot holds the shutter for CAM1_DURATION seconds; PX4's
                // TRIG_ACT_TIME is in milliseconds.
                <Input
                  label={lbl(`CAM1_DURATION — ${tr("pulseDuration")}`)}
                  type="number"
                  step={isPx4 ? "1" : "0.1"}
                  min="0"
                  unit={isPx4 ? "ms" : "s"}
                  value={p("CAM1_DURATION")}
                  onChange={(e) => set("CAM1_DURATION", e.target.value)}
                />
              )}
            </FcSection>
          )}

          {/* Distance Trigger */}
          {camEnabled && params.has("CAM1_TRIGG_DIST") && (
            <FcSection icon={<Ruler size={14} />} title={tr("distanceTrigger")} description={tr("automaticCaptureAtDistanceIntervals")}>
              <Input
                label={lbl(`CAM1_TRIGG_DIST — ${tr("triggerDistance")}`)}
                type="number"
                step="0.5"
                min="0"
                unit="m"
                value={p("CAM1_TRIGG_DIST")}
                onChange={(e) => set("CAM1_TRIGG_DIST", e.target.value)}
              />
              <p className="text-[10px] text-text-tertiary">{tr("setTo0ToDisable")}</p>
            </FcSection>
          )}

          {/* Survey Helper */}
          {camEnabled && (
            <FcSection icon={<Calculator size={14} />} title={tr("surveyHelper")} description={tr("calculateTriggerDistanceFromSurvey")}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-text-tertiary block mb-1">{tr("altitude")}</label>
                  <input
                    type="number"
                    value={surveyAlt}
                    onChange={(e) => setSurveyAlt(Number(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded"
                  />
                  <span className="text-[9px] text-text-tertiary">m</span>
                </div>
                <div>
                  <label className="text-[10px] text-text-tertiary block mb-1">{tr("cameraFOV")}</label>
                  <input
                    type="number"
                    value={surveyFov}
                    onChange={(e) => setSurveyFov(Number(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded"
                  />
                  <span className="text-[9px] text-text-tertiary">°</span>
                </div>
                <div>
                  <label className="text-[10px] text-text-tertiary block mb-1">{tr("overlap")}</label>
                  <input
                    type="number"
                    value={surveyOverlap}
                    onChange={(e) => setSurveyOverlap(Number(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded"
                  />
                  <span className="text-[9px] text-text-tertiary">%</span>
                </div>
              </div>
              {calculatedTriggerDist > 0 && (
                <div className="flex items-center gap-2 mt-2 p-2 bg-bg-tertiary/50 rounded">
                  <span className="text-xs text-text-secondary">{tr("calculatedDistance")}</span>
                  <span className="text-sm font-mono text-accent-primary">{calculatedTriggerDist.toFixed(1)} m</span>
                  <Button size="sm" variant="ghost" onClick={applyCalculatedDistance} className="ml-auto">
                    {tr("apply")}
                  </Button>
                </div>
              )}
            </FcSection>
          )}

          {/* Manual Trigger */}
          {camEnabled && connected && (
            <FcSection icon={<Camera size={14} />} title={tr("manualTrigger")} description={tr("triggerCameraManually")}>
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={handleTrigger}>
                  <Aperture size={12} className="mr-1" /> {tr("triggerCamera")}
                </Button>
                <span className="text-xs font-mono text-text-tertiary">
                  Images: {imageCount}
                </span>
              </div>
            </FcSection>
          )}

          {/* Interval Trigger */}
          {camEnabled && connected && (
            <FcSection icon={<Timer size={14} />} title={tr("intervalTrigger")} description={tr("triggerCameraAtAFixed")}>
              <div className="flex items-center gap-3">
                <Input
                  label={tr("interval")}
                  type="number"
                  step="1"
                  min="1"
                  unit="s"
                  value={String(intervalSec)}
                  onChange={(e) => setIntervalSec(Number(e.target.value) || 1)}
                  disabled={intervalActive}
                />
                <Button
                  size="sm"
                  variant={intervalActive ? "danger" : "primary"}
                  onClick={toggleIntervalTrigger}
                >
                  {intervalActive ? "Stop" : "Start"}
                </Button>
              </div>
              {intervalActive && (
                <p className="text-[10px] text-status-success">
                  Active: triggering every {intervalSec}s ({imageCount} images taken)
                </p>
              )}
            </FcSection>
          )}

          {/* Save */}
          <PanelSaveBar
            onSave={handleSave}
            saving={saving}
            saveDisabled={!hasDirty || !connected}
            showFlash={hasRamWrites}
            onFlash={handleFlash}
            flashing={flashing}
            showConnectHint={!connected}
            showUnsavedHint={hasDirty && connected}
          />
        </div>
      </div>
    </ArmedWarningBanner>
  );
}

