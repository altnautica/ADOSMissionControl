"use client";

/**
 * @module JoystickCalibrationWizard
 * @description 3-step joystick/gamepad calibration wizard.
 * Step 1: Record center position. Step 2: Record axis extremes. Step 3: Verify and save.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { X, ChevronRight, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInputStore, type GamepadCalibration } from "@/stores/input-store";

type Step = "center" | "range" | "verify";

const AXIS_LABELS = ["Roll", "Pitch", "Throttle", "Yaw"] as const;
const CENTER_SAMPLE_MS = 1500;
const RANGE_SAMPLE_MS = 5000;

interface Props {
  onClose: () => void;
}

function AxisBar({ label, raw, calibrated }: { label: string; raw: number; calibrated?: number }) {
  const rawPct = ((raw + 1) / 2) * 100;
  const calPct = calibrated !== undefined ? ((calibrated + 1) / 2) * 100 : undefined;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-text-secondary font-medium">{label}</span>
        <span className="font-mono text-text-tertiary">
          {raw.toFixed(3)}
          {calibrated !== undefined && (
            <span className="text-accent-primary ml-2">{calibrated.toFixed(3)}</span>
          )}
        </span>
      </div>
      <div className="relative h-3 bg-bg-primary rounded overflow-hidden">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-default z-10" />
        {/* Raw value (gray) */}
        <div
          className="absolute top-0 bottom-0 w-1.5 bg-text-tertiary/50 rounded transition-all duration-75"
          style={{ left: `calc(${rawPct}% - 3px)` }}
        />
        {/* Calibrated value (blue) */}
        {calPct !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-1.5 bg-accent-primary rounded transition-all duration-75"
            style={{ left: `calc(${calPct}% - 3px)` }}
          />
        )}
      </div>
    </div>
  );
}

export function JoystickCalibrationWizard({ onClose }: Props) {
  const [step, setStep] = useState<Step>("center");
  const rawAxes = useInputStore((s) => s.rawAxes);
  const axes = useInputStore((s) => s.axes);
  const setCalibration = useInputStore((s) => s.setCalibration);

  // Sampling state
  const [sampling, setSampling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [centerSamples, setCenterSamples] = useState<number[][]>([]);
  const [cal, setCal] = useState<GamepadCalibration | null>(null);

  // Range tracking refs (updated in rAF, not state)
  const rangeMin = useRef<[number, number, number, number]>([0, 0, 0, 0]);
  const rangeMax = useRef<[number, number, number, number]>([0, 0, 0, 0]);

  // Step 1: Sample center
  const startCenterSampling = useCallback(() => {
    setSampling(true);
    setProgress(0);
    const samples: number[][] = [];
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setProgress(Math.min(elapsed / CENTER_SAMPLE_MS, 1));

      const currentRaw = useInputStore.getState().rawAxes;
      samples.push([...currentRaw]);

      if (elapsed >= CENTER_SAMPLE_MS) {
        clearInterval(interval);
        setSampling(false);
        setCenterSamples(samples);

        // Average all samples for center values
        const center: [number, number, number, number] = [0, 0, 0, 0];
        for (const s of samples) {
          for (let i = 0; i < 4; i++) center[i] += s[i];
        }
        for (let i = 0; i < 4; i++) center[i] /= samples.length;

        // Initialize range with center values
        rangeMin.current = [...center] as [number, number, number, number];
        rangeMax.current = [...center] as [number, number, number, number];

        // Pre-build cal with center, will fill min/max in step 2
        setCal({
          center,
          min: [...center] as [number, number, number, number],
          max: [...center] as [number, number, number, number],
        });

        setStep("range");
      }
    }, 16); // ~60fps
  }, []);

  // Step 2: Track range
  const startRangeSampling = useCallback(() => {
    setSampling(true);
    setProgress(0);
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setProgress(Math.min(elapsed / RANGE_SAMPLE_MS, 1));

      const currentRaw = useInputStore.getState().rawAxes;
      for (let i = 0; i < 4; i++) {
        if (currentRaw[i] < rangeMin.current[i]) rangeMin.current[i] = currentRaw[i];
        if (currentRaw[i] > rangeMax.current[i]) rangeMax.current[i] = currentRaw[i];
      }

      if (elapsed >= RANGE_SAMPLE_MS) {
        clearInterval(interval);
        setSampling(false);

        setCal((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            min: [...rangeMin.current] as [number, number, number, number],
            max: [...rangeMax.current] as [number, number, number, number],
          };
        });

        setStep("verify");
      }
    }, 16);
  }, []);

  // Auto-start sampling when entering each step
  useEffect(() => {
    if (step === "center") {
      const timer = setTimeout(startCenterSampling, 500);
      return () => clearTimeout(timer);
    }
    if (step === "range") {
      const timer = setTimeout(startRangeSampling, 500);
      return () => clearTimeout(timer);
    }
  }, [step, startCenterSampling, startRangeSampling]);

  function handleSave() {
    if (cal) {
      setCalibration(cal);
      onClose();
    }
  }

  function handleRedo() {
    setCal(null);
    setCenterSamples([]);
    setStep("center");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] bg-surface-primary border border-border-default rounded-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-sm font-semibold text-text-primary">Joystick Calibration</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default">
          {(["center", "range", "verify"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <ChevronRight size={10} className="text-text-tertiary" />}
              <span className={cn(
                "text-[10px] font-medium uppercase tracking-wider",
                step === s ? "text-accent-primary" : "text-text-tertiary"
              )}>
                {i + 1}. {s}
              </span>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 min-h-[220px]">
          {step === "center" && (
            <>
              <p className="text-xs text-text-secondary">
                Release all sticks and leave them centered. Do not touch the controller.
              </p>
              {sampling && (
                <div className="space-y-2">
                  <div className="h-1.5 bg-bg-primary rounded overflow-hidden">
                    <div
                      className="h-full bg-accent-primary transition-all duration-100"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-text-tertiary text-center">Sampling center position...</p>
                </div>
              )}
              <div className="space-y-2">
                {AXIS_LABELS.map((label, i) => (
                  <AxisBar key={label} label={label} raw={rawAxes[i]} />
                ))}
              </div>
            </>
          )}

          {step === "range" && (
            <>
              <p className="text-xs text-text-secondary">
                Move all sticks to their full range. Push each stick to all four corners, then return to center.
              </p>
              {sampling && (
                <div className="space-y-2">
                  <div className="h-1.5 bg-bg-primary rounded overflow-hidden">
                    <div
                      className="h-full bg-accent-primary transition-all duration-100"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-text-tertiary text-center">Recording axis range...</p>
                </div>
              )}
              <div className="space-y-2">
                {AXIS_LABELS.map((label, i) => (
                  <AxisBar key={label} label={label} raw={rawAxes[i]} />
                ))}
              </div>
            </>
          )}

          {step === "verify" && (
            <>
              <p className="text-xs text-text-secondary">
                Move sticks to verify calibration. Gray = raw input, blue = calibrated output. Center should read 0.000, extremes should reach -1.000 / 1.000.
              </p>
              <div className="space-y-2">
                {AXIS_LABELS.map((label, i) => (
                  <AxisBar key={label} label={label} raw={rawAxes[i]} calibrated={axes[i]} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          {step === "verify" && (
            <>
              <button
                onClick={handleRedo}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary border border-border-default rounded hover:border-accent-primary hover:text-accent-primary transition-colors"
              >
                <RotateCcw size={12} />
                Redo
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-accent-primary text-white rounded hover:opacity-90 transition-opacity"
              >
                <Save size={12} />
                Save Calibration
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
