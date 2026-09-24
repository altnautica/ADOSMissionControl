/**
 * @module map/context-menu/panels/PoiInputPanel
 * @description POI label input sub-panel inside the right-click menu.
 * Operator types a marker name and confirms.
 * @license GPL-3.0-only
 */

"use client";

import { forwardRef } from "react";

interface PoiInputPanelProps {
  label: string;
  setLabel: (s: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export const PoiInputPanel = forwardRef<HTMLInputElement, PoiInputPanelProps>(
  function PoiInputPanel({ label, setLabel, onConfirm, onCancel }, ref) {
    return (
      <div className="px-3 py-2 border-b border-border-default">
        <div className="text-[10px] font-mono text-text-secondary mb-1.5">POI Label</div>
        <div className="flex gap-1">
          <input
            ref={ref}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
              if (e.key === "Escape") onCancel();
            }}
            placeholder="Marker name..."
            className="flex-1 px-1.5 py-0.5 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded text-text-primary focus:border-accent-primary focus:outline-none placeholder:text-text-tertiary/50"
          />
          <button
            onClick={onConfirm}
            className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-accent-secondary/20 border border-accent-secondary/40 text-accent-secondary rounded hover:bg-accent-secondary/30 cursor-pointer"
          >
            Add
          </button>
        </div>
      </div>
    );
  },
);
