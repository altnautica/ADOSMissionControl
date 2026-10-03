"use client";

/**
 * @module JoystickCalibrationWizard
 * @description 3-step joystick/gamepad calibration wizard.
 * Step 1: Record center position. Step 2: Record axis extremes. Step 3: Verify and save.
 * Calibration is recorded per physical axis of the connected controller and
 * saved under that controller's id, so the stick mode and a different pad
 * never pick up the wrong stick's centre and travel.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronRight, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { useInputStore, type GamepadCalibration } from "@/stores/input-store";
import { applyCal } from "@/lib/input/gamepad-poller";

type Step = "center" | "range" | "verify";

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
  const padAxes = useInputStore((s) => s.padAxes);
  const setCalibration = useInputStore((s) => s.setCalibration);
  // The controller being calibrated, fixed when the wizard opens: the result
  // is saved under this id even if another pad becomes active meanwhile.
  const [gamepadId] = useState(() => useInputStore.getState().gamepadId);

  // Sampling state
  const [sampling, setSampling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [cal, setCal] = useState<GamepadCalibration | null>(null);

  // Range tracking refs (updated in the sampling interval, not state)
  const rangeMin = useRef<number[]>([]);
  const rangeMax = useRef<number[]>([]);

  // Step 1: Sample center
  const startCenterSampling = useCallback(() => {
    setSampling(true);
    setProgress(0);
    const samples: number[][] = [];
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setProgress(Math.min(elapsed / CENTER_SAMPLE_MS, 1));

      samples.push([...useInputStore.getState().padAxes]);

      if (elapsed >= CENTER_SAMPLE_MS) {
        clearInterval(interval);
        setSampling(false);

        // Average all samples per physical axis.
        const axisCount = Math.min(...samples.map((s) => s.length));
        const center = new Array<number>(axisCount).fill(0);
        for (const s of samples) {
          for (let i = 0; i < axisCount; i++) center[i] += s[i];
        }
        for (let i = 0; i < axisCount; i++) center[i] /= samples.length;

        // Initialize range with center values
        rangeMin.current = [...center];
        rangeMax.current = [...center];

        // Pre-build cal with center, will fill min/max in step 2
        setCal({ center, min: [...center], max: [...center] });

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

      const current = useInputStore.getState().padAxes;
      for (let i = 0; i < rangeMin.current.length; i++) {
        const v = current[i];
        if (v === undefined) continue;
        if (v < rangeMin.current[i]) rangeMin.current[i] = v;
        if (v > rangeMax.current[i]) rangeMax.current[i] = v;
      }

      if (elapsed >= RANGE_SAMPLE_MS) {
        clearInterval(interval);
        setSampling(false);

        setCal((prev) => {
          if (!prev) return prev;
          return { ...prev, min: [...rangeMin.current], max: [...rangeMax.current] };
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
    if (cal && gamepadId) {
      setCalibration(gamepadId, cal);
      onClose();
    }
  }

  function handleRedo() {
    setCal(null);
    setStep("center");
  }

  return (
    <Modal
      open
      onClose={onClose}
      // Hardcoded English title: no locale key exists for it, so the literal
      // is passed through unchanged rather than pointing at an invented key.
      title="Joystick Calibration"
      size="sm"
      // A backdrop click mid-sampling would throw away the samples already
      // collected, and the hand-rolled overlay never dismissed on one. Escape
      // and the X close, which the overlay did not offer at all.
      disableBackdropClose
      // The step strip is full-bleed with its own divider, so the child owns
      // its padding.
      noBodyPadding
      // Always a node, so the action strip keeps its height across all three
      // steps and the panel does not resize when the buttons appear.
      footer={
        <>
          {step === "verify" && (
            <>
              <button
                type="button"
                onClick={handleRedo}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary border border-border-default rounded hover:border-accent-primary hover:text-accent-primary transition-colors focus-ring"
              >
                <RotateCcw size={12} aria-hidden="true" />
                Redo
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-accent-primary text-accent-foreground rounded hover:opacity-90 transition-opacity focus-ring"
              >
                <Save size={12} aria-hidden="true" />
                Save Calibration
              </button>
            </>
          )}
        </>
      }
    >
      {/* Step indicator */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default">
        {(["center", "range", "verify"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight size={10} className="text-text-tertiary" aria-hidden="true" />}
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
              {padAxes.map((v, i) => (
                <AxisBar key={i} label={`Axis ${i}`} raw={v} />
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
              {padAxes.map((v, i) => (
                <AxisBar key={i} label={`Axis ${i}`} raw={v} />
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
              {padAxes.map((v, i) => (
                <AxisBar
                  key={i}
                  label={`Axis ${i}`}
                  raw={v}
                  calibrated={
                    cal && i < cal.center.length
                      ? applyCal(v, cal.center[i], cal.min[i], cal.max[i])
                      : undefined
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
