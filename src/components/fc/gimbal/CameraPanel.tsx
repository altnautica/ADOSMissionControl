"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useFcPanelState } from "@/hooks/use-fc-panel-state";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Camera, Save, HardDrive, Aperture, Ruler, Calculator, Timer } from "lucide-react";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import {
  CAMERA_PARAMS, OPTIONAL_CAMERA_PARAMS, CAM_TYPE_OPTIONS, PX4_TRIG_MODE_OPTIONS,
  CameraCard as Card,
} from "./camera-constants";
import { withCurrent as withCurrentOption } from "../frame/enum-options";

export function CameraPanel() {
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, getProtocol,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = useFcPanelState({ paramNames: CAMERA_PARAMS, optionalParams: OPTIONAL_CAMERA_PARAMS, panelId: "camera" });
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;
  const [saving, setSaving] = useState(false);
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

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok);
  }

  async function handleTrigger() {
    const protocol = getProtocol();
    if (!protocol) return;
    const result = await protocol.cameraTrigger();
    if (result.success) {
      setImageCount((c) => c + 1);
      toast("Camera triggered", "success");
    } else {
      toast(result.message || "Camera trigger refused", "error");
    }
  }

  function applyCalculatedDistance() {
    if (calculatedTriggerDist > 0) {
      set("CAM1_TRIGG_DIST", calculatedTriggerDist.toFixed(1));
      toast(`Trigger distance set to ${calculatedTriggerDist.toFixed(1)} m`, "success");
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
      toast("Interval trigger stopped", "success");
    } else {
      if (intervalSec <= 0) {
        toast("Enter a positive interval", "warning");
        return;
      }
      void doIntervalTrigger();
      intervalRef.current = setInterval(() => void doIntervalTrigger(), intervalSec * 1000);
      setIntervalActive(true);
      toast(`Triggering every ${intervalSec}s`, "success");
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
            title="Camera"
            subtitle="Camera trigger, servo settings, distance-based capture"
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
          <Card icon={<Camera size={14} />} title="Camera Configuration" description="Camera type and trigger method">
            <Select
              label={lbl(isPx4 ? "CAM1_TYPE — Trigger Mode" : "CAM1_TYPE — Camera Type")}
              options={typeOptions}
              value={p("CAM1_TYPE")}
              onChange={(v) => set("CAM1_TYPE", v)}
            />
          </Card>

          {/* Servo Trigger Settings */}
          {camEnabled && showServo && (
            <Card icon={<Aperture size={14} />} title="Servo Trigger" description="PWM values for servo-based shutter">
              {params.has("CAM1_SERVO_OFF") && (
                <Input
                  label={lbl("CAM1_SERVO_OFF — Servo Off PWM")}
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
                  label={lbl("CAM1_SERVO_ON — Servo On PWM")}
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
                  label={lbl("CAM1_DURATION — Pulse Duration")}
                  type="number"
                  step={isPx4 ? "1" : "0.1"}
                  min="0"
                  unit={isPx4 ? "ms" : "s"}
                  value={p("CAM1_DURATION")}
                  onChange={(e) => set("CAM1_DURATION", e.target.value)}
                />
              )}
            </Card>
          )}

          {/* Distance Trigger */}
          {camEnabled && params.has("CAM1_TRIGG_DIST") && (
            <Card icon={<Ruler size={14} />} title="Distance Trigger" description="Automatic capture at distance intervals">
              <Input
                label={lbl("CAM1_TRIGG_DIST — Trigger Distance")}
                type="number"
                step="0.5"
                min="0"
                unit="m"
                value={p("CAM1_TRIGG_DIST")}
                onChange={(e) => set("CAM1_TRIGG_DIST", e.target.value)}
              />
              <p className="text-[10px] text-text-tertiary">Set to 0 to disable distance-based triggering</p>
            </Card>
          )}

          {/* Survey Helper */}
          {camEnabled && (
            <Card icon={<Calculator size={14} />} title="Survey Helper" description="Calculate trigger distance from survey parameters">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-text-tertiary block mb-1">Altitude</label>
                  <input
                    type="number"
                    value={surveyAlt}
                    onChange={(e) => setSurveyAlt(Number(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded"
                  />
                  <span className="text-[9px] text-text-tertiary">m</span>
                </div>
                <div>
                  <label className="text-[10px] text-text-tertiary block mb-1">Camera FOV</label>
                  <input
                    type="number"
                    value={surveyFov}
                    onChange={(e) => setSurveyFov(Number(e.target.value) || 0)}
                    className="w-full px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded"
                  />
                  <span className="text-[9px] text-text-tertiary">°</span>
                </div>
                <div>
                  <label className="text-[10px] text-text-tertiary block mb-1">Overlap</label>
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
                  <span className="text-xs text-text-secondary">Calculated distance:</span>
                  <span className="text-sm font-mono text-accent-primary">{calculatedTriggerDist.toFixed(1)} m</span>
                  <Button size="sm" variant="ghost" onClick={applyCalculatedDistance} className="ml-auto">
                    Apply
                  </Button>
                </div>
              )}
            </Card>
          )}

          {/* Manual Trigger */}
          {camEnabled && connected && (
            <Card icon={<Camera size={14} />} title="Manual Trigger" description="Trigger camera manually">
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={handleTrigger}>
                  <Aperture size={12} className="mr-1" /> Trigger Camera
                </Button>
                <span className="text-xs font-mono text-text-tertiary">
                  Images: {imageCount}
                </span>
              </div>
            </Card>
          )}

          {/* Interval Trigger */}
          {camEnabled && connected && (
            <Card icon={<Timer size={14} />} title="Interval Trigger" description="Trigger camera at a fixed time interval">
              <div className="flex items-center gap-3">
                <Input
                  label="Interval"
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
            </Card>
          )}

          {/* Save */}
          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button
              variant="primary"
              size="lg"
              icon={<Save size={14} />}
              disabled={!hasDirty || !connected}
              loading={saving}
              onClick={handleSave}
            >
              Save to Flight Controller
            </Button>
            {hasRamWrites && (
              <Button
                variant="secondary"
                size="lg"
                icon={<HardDrive size={14} />}
                onClick={handleFlash}
              >
                Write to Flash
              </Button>
            )}
            {!connected && (
              <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>
            )}
            {hasDirty && connected && (
              <span className="text-[10px] text-status-warning">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>
    </ArmedWarningBanner>
  );
}

