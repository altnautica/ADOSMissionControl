"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Save, HardDrive, Play, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const SERVO_COUNT = 16;

// Build param list for all 16 servos
const SERVO_PARAMS = Array.from({ length: SERVO_COUNT }, (_, i) => {
  const n = i + 1;
  return [`SERVO${n}_MIN`, `SERVO${n}_MAX`, `SERVO${n}_TRIM`, `SERVO${n}_FUNCTION`];
}).flat();

const PWM_ABS_MIN = 800;
const PWM_ABS_MAX = 2200;

interface ServoRowProps {
  index: number;
  min: number;
  max: number;
  trim: number;
  func: number;
  livePwm: number;
  onSetLocal: (name: string, value: number) => void;
  onTest: (servo: number, pwm: number) => void;
  connected: boolean;
}

function ServoRow({ index, min, max, trim, func, livePwm, onSetLocal, onTest, connected }: ServoRowProps) {
  const n = index + 1;
  const [expanded, setExpanded] = useState(false);
  const [testPwm, setTestPwm] = useState(trim);
  const range = max - min;
  const travelPct = range > 0 ? Math.round(((range) / (PWM_ABS_MAX - PWM_ABS_MIN)) * 100) : 0;

  // PWM range bar visualization
  const barMin = ((min - PWM_ABS_MIN) / (PWM_ABS_MAX - PWM_ABS_MIN)) * 100;
  const barMax = ((max - PWM_ABS_MIN) / (PWM_ABS_MAX - PWM_ABS_MIN)) * 100;
  const barTrim = ((trim - PWM_ABS_MIN) / (PWM_ABS_MAX - PWM_ABS_MIN)) * 100;
  const barLive = livePwm > 0 ? ((livePwm - PWM_ABS_MIN) / (PWM_ABS_MAX - PWM_ABS_MIN)) * 100 : -1;

  const funcLabel = func === 0 ? "Disabled" : `Fn ${func}`;
  const isDisabled = func === 0;

  return (
    <div className={cn("border-b border-border-default/50 last:border-0", isDisabled && "opacity-50")}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary/50 text-left"
      >
        {expanded ? <ChevronDown size={12} className="text-text-tertiary" /> : <ChevronRight size={12} className="text-text-tertiary" />}
        <span className="text-xs font-mono text-text-secondary w-16 shrink-0">SERVO{n}</span>
        <span className="text-[10px] text-text-tertiary w-16 shrink-0">{funcLabel}</span>
        {/* Mini PWM range bar */}
        <div className="relative h-3 bg-bg-tertiary flex-1 border border-border-default/50">
          {/* Active range */}
          <div
            className="absolute top-0 h-full bg-accent-primary/30"
            style={{ left: `${Math.max(0, barMin)}%`, width: `${Math.max(0, barMax - barMin)}%` }}
          />
          {/* Trim marker */}
          <div
            className="absolute top-0 h-full w-[2px] bg-status-success"
            style={{ left: `${Math.max(0, Math.min(100, barTrim))}%` }}
          />
          {/* Live value marker */}
          {barLive >= 0 && (
            <div
              className="absolute top-0 h-full w-[2px] bg-accent-primary"
              style={{ left: `${Math.max(0, Math.min(100, barLive))}%` }}
            />
          )}
        </div>
        <span className="text-[10px] font-mono text-text-tertiary w-20 text-right shrink-0">
          {min}-{max}
        </span>
        <span className="text-[10px] font-mono text-text-tertiary w-10 text-right shrink-0">
          {travelPct}%
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-bg-tertiary/30">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-text-tertiary block mb-1">Min PWM</label>
              <input
                type="number"
                min={PWM_ABS_MIN}
                max={PWM_ABS_MAX}
                value={min}
                onChange={(e) => onSetLocal(`SERVO${n}_MIN`, Number(e.target.value))}
                className="w-full h-7 px-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary block mb-1">Trim PWM</label>
              <input
                type="number"
                min={PWM_ABS_MIN}
                max={PWM_ABS_MAX}
                value={trim}
                onChange={(e) => onSetLocal(`SERVO${n}_TRIM`, Number(e.target.value))}
                className="w-full h-7 px-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-text-tertiary block mb-1">Max PWM</label>
              <input
                type="number"
                min={PWM_ABS_MIN}
                max={PWM_ABS_MAX}
                value={max}
                onChange={(e) => onSetLocal(`SERVO${n}_MAX`, Number(e.target.value))}
                className="w-full h-7 px-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
              />
            </div>
          </div>

          {/* Travel range slider */}
          <div className="mb-3">
            <label className="text-[10px] text-text-tertiary block mb-1">
              Travel Range: {travelPct}%
            </label>
            <input
              type="range"
              min={10}
              max={100}
              value={travelPct}
              onChange={(e) => {
                const pct = Number(e.target.value);
                const totalRange = PWM_ABS_MAX - PWM_ABS_MIN;
                const halfRange = Math.round((totalRange * pct / 100) / 2);
                const center = trim || 1500;
                onSetLocal(`SERVO${n}_MIN`, Math.max(PWM_ABS_MIN, center - halfRange));
                onSetLocal(`SERVO${n}_MAX`, Math.min(PWM_ABS_MAX, center + halfRange));
              }}
              className="w-full h-1.5 accent-accent-primary"
            />
          </div>

          {/* PWM range visualization */}
          <div className="relative h-6 bg-bg-tertiary border border-border-default mb-3">
            <div
              className="absolute top-0 h-full bg-accent-primary/20 border-l border-r border-accent-primary/40"
              style={{ left: `${Math.max(0, barMin)}%`, width: `${Math.max(0, barMax - barMin)}%` }}
            />
            <div
              className="absolute top-0 h-full w-[2px] bg-status-success"
              style={{ left: `${Math.max(0, Math.min(100, barTrim))}%` }}
              title={`Trim: ${trim}`}
            />
            {barLive >= 0 && (
              <div
                className="absolute top-0 h-full w-[3px] bg-accent-primary"
                style={{ left: `${Math.max(0, Math.min(100, barLive))}%` }}
                title={`Live: ${livePwm}`}
              />
            )}
            {/* Scale labels */}
            <span className="absolute bottom-0 left-0 text-[8px] font-mono text-text-tertiary px-0.5">{PWM_ABS_MIN}</span>
            <span className="absolute bottom-0 right-0 text-[8px] font-mono text-text-tertiary px-0.5">{PWM_ABS_MAX}</span>
          </div>

          {/* Servo test */}
          {connected && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-tertiary shrink-0">Test PWM:</span>
              <input
                type="number"
                min={PWM_ABS_MIN}
                max={PWM_ABS_MAX}
                value={testPwm}
                onChange={(e) => setTestPwm(Number(e.target.value))}
                className="w-20 h-7 px-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
              />
              <input
                type="range"
                min={min}
                max={max}
                value={testPwm}
                onChange={(e) => setTestPwm(Number(e.target.value))}
                className="flex-1 h-1.5 accent-accent-primary"
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Play size={10} />}
                onClick={() => onTest(n, testPwm)}
              >
                Test
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ServoCalibrationSection() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);
  const servoBuffer = useTelemetryStore((s) => s.servoOutput);
  const telVersion = useTelemetryStore((s) => s._version);

  const {
    params, loading, dirtyParams, hasRamWrites,
    hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: SERVO_PARAMS, panelId: "servo-cal", autoLoad: false });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  const liveServos = useMemo(() => {
    const latest = servoBuffer.latest();
    return latest?.servos ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servoBuffer, telVersion]);

  // Armed hard-block. `SERVOn_FUNCTION` 33-40 are MOTOR outputs, so Test at
  // PWM 2000 spins a motor — and this control had no armed gate and no
  // props-removed acknowledgement at all, unlike every sibling actuation
  // control (MotorTestSection, ServoTestSection, BfMotorTest, Px4ActuatorTest,
  // BfDshotCommands). Its host's `ArmedLockOverlay` is deliberately
  // non-blocking, so nothing upstream stopped it either: the button stayed
  // clickable while the aircraft was armed and airborne.
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const [testEnabled, setTestEnabled] = useState(false);
  useEffect(() => {
    if (isHardBlocked) setTestEnabled(false);
  }, [isHardBlocked]);

  const handleTest = useCallback((servo: number, pwm: number) => {
    if (isHardBlocked) {
      toast(hardBlockMessage, "error");
      return;
    }
    if (!testEnabled) {
      toast("Enable servo output test first — outputs 33-40 are motors", "warning");
      return;
    }
    const protocol = getSelectedProtocol();
    if (!protocol) return;
    protocol.setServo(servo, pwm);
    toast(`Servo ${servo} set to ${pwm}`, "info");
  }, [getSelectedProtocol, toast, isHardBlocked, hardBlockMessage, testEnabled]);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Servo endpoints saved", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    showFlashResult(await commitToFlash(), { successMessage: "Written to flash" });
  }

  return (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">Servo Endpoint Calibration</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Set min/max/trim PWM and travel range for each servo output. Click a row to expand.
          </p>
        </div>
        {!hasLoaded && connected && (
          <Button variant="secondary" size="sm" onClick={refresh} loading={loading}>
            Read
          </Button>
        )}
      </div>

      {/* Actuation safety gate, matching every sibling actuation control. */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2 p-2 bg-status-error/10 border border-status-error/20">
          <AlertTriangle size={14} className="text-status-error shrink-0" />
          <span className="text-[10px] text-status-error">
            Remove propellers before testing outputs. Outputs 33-40 are MOTORS —
            a test at high PWM spins them.
          </span>
        </div>
        <Toggle
          label="Enable output test (props removed)"
          checked={testEnabled}
          onChange={setTestEnabled}
          disabled={isHardBlocked || !connected}
        />
        {isHardBlocked && (
          <div className="flex items-center gap-2 p-2 bg-status-error/10 border border-status-error/20">
            <AlertTriangle size={14} className="text-status-error shrink-0" />
            <span className="text-[10px] text-status-error">{hardBlockMessage}</span>
          </div>
        )}
      </div>

      {hasLoaded && (
        <>
          <div className="border border-border-default bg-bg-primary mb-3">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default text-[10px] text-text-tertiary">
              <span className="w-4" />
              <span className="w-16 shrink-0">Output</span>
              <span className="w-16 shrink-0">Function</span>
              <span className="flex-1">Range</span>
              <span className="w-20 text-right shrink-0">PWM</span>
              <span className="w-10 text-right shrink-0">Travel</span>
            </div>
            {Array.from({ length: SERVO_COUNT }, (_, i) => {
              const n = i + 1;
              return (
                <ServoRow
                  key={i}
                  index={i}
                  min={params.get(`SERVO${n}_MIN`) ?? 1000}
                  max={params.get(`SERVO${n}_MAX`) ?? 2000}
                  trim={params.get(`SERVO${n}_TRIM`) ?? 1500}
                  func={params.get(`SERVO${n}_FUNCTION`) ?? 0}
                  livePwm={liveServos[i] ?? 0}
                  onSetLocal={setLocalValue}
                  onTest={handleTest}
                  connected={connected}
                />
              );
            })}
          </div>

          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={12} />}
              onClick={handleSave}
              disabled={!hasDirty || saving}
              loading={saving}
            >
              Save
            </Button>
            {hasRamWrites && (
              <Button variant="secondary" size="sm" icon={<HardDrive size={12} />} onClick={handleFlash}>
                Write to Flash
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
