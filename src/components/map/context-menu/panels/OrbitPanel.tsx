/**
 * @module map/context-menu/panels/OrbitPanel
 * @description Orbit configuration sub-panel inside the right-click menu.
 * Operator picks radius and direction, then confirms. The radius is typed as
 * a free draft and clamped only on blur or confirm, so a partial entry ("2"
 * on the way to "20") is never clamped into a different radius.
 * @license GPL-3.0-only
 */

"use client";

import { useState } from "react";

export const ORBIT_RADIUS_MIN_M = 5;
export const ORBIT_RADIUS_MAX_M = 500;

/** The orbit radius a draft entry commits to; `fallback` when it is not a number. */
export function commitOrbitRadius(draft: string, fallback: number): number {
  const value = Number(draft);
  if (draft.trim() === "" || !Number.isFinite(value)) return fallback;
  return Math.max(ORBIT_RADIUS_MIN_M, Math.min(ORBIT_RADIUS_MAX_M, value));
}

interface OrbitPanelProps {
  radius: number;
  setRadius: (r: number) => void;
  clockwise: boolean;
  setClockwise: (cw: boolean) => void;
  /** Called with the committed, clamped radius. */
  onConfirm: (radius: number) => void;
  onCancel: () => void;
}

export function OrbitPanel({
  radius,
  setRadius,
  clockwise,
  setClockwise,
  onConfirm,
  onCancel,
}: OrbitPanelProps) {
  const [draft, setDraft] = useState(String(radius));

  const commit = (): number => {
    const next = commitOrbitRadius(draft, radius);
    setDraft(String(next));
    setRadius(next);
    return next;
  };

  return (
    <div className="px-3 py-2 border-b border-border-default">
      <div className="text-[10px] font-mono text-text-secondary mb-1.5">Orbit Configuration</div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-[9px] text-text-tertiary w-12">Radius</label>
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm(commit());
          }}
          aria-label="Orbit radius"
          min={ORBIT_RADIUS_MIN_M}
          max={ORBIT_RADIUS_MAX_M}
          step={5}
          className="flex-1 px-1.5 py-0.5 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded text-text-primary focus:border-accent-primary focus:outline-none"
        />
        <span className="text-[9px] text-text-tertiary">m</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[9px] text-text-tertiary w-12">Direction</label>
        <div className="flex gap-1">
          <button
            onClick={() => setClockwise(true)}
            className={`px-2 py-0.5 text-[9px] font-mono rounded border cursor-pointer ${
              clockwise
                ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                : "border-border-default text-text-tertiary"
            }`}
          >
            CW
          </button>
          <button
            onClick={() => setClockwise(false)}
            className={`px-2 py-0.5 text-[9px] font-mono rounded border cursor-pointer ${
              !clockwise
                ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                : "border-border-default text-text-tertiary"
            }`}
          >
            CCW
          </button>
        </div>
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => onConfirm(commit())}
          className="flex-1 px-2 py-1 text-[10px] font-mono font-semibold bg-accent-primary/20 border border-accent-primary/40 text-accent-primary rounded hover:bg-accent-primary/30 cursor-pointer"
        >
          Start Orbit
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-[10px] font-mono text-text-tertiary border border-border-default rounded hover:text-text-primary cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
