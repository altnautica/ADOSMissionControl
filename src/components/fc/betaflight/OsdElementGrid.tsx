"use client";

import {
  Eye, EyeOff, Save, RotateCcw,
  Layers, HardDrive, Copy, ClipboardPaste,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface OsdElement {
  id: string;
  label: string;
  shortLabel: string;
  enabled: boolean;
  row: number;
  col: number;
}

export type VideoFormat = "PAL" | "NTSC";

export const PRESETS: Record<string, Partial<Record<string, { enabled: boolean; row: number; col: number }>>> = {
  Racing: {
    ALTITUDE: { enabled: true, row: 1, col: 1 },
    BATTVOLT: { enabled: true, row: 1, col: 24 },
    RSSI: { enabled: true, row: 0, col: 26 },
    FLTMODE: { enabled: true, row: 14, col: 12 },
    THROTTLE: { enabled: true, row: 8, col: 24 },
    ARMING: { enabled: true, row: 7, col: 12 },
  },
  Cruise: {
    ALTITUDE: { enabled: true, row: 1, col: 1 },
    BATTVOLT: { enabled: true, row: 1, col: 23 },
    RSSI: { enabled: true, row: 0, col: 26 },
    SATS: { enabled: true, row: 0, col: 1 },
    FLTMODE: { enabled: true, row: 14, col: 12 },
    GSPEED: { enabled: true, row: 8, col: 1 },
    HEADING: { enabled: true, row: 0, col: 12 },
    HOMEDIST: { enabled: true, row: 14, col: 23 },
    HORIZON: { enabled: true, row: 7, col: 12 },
    COMPASS: { enabled: true, row: 14, col: 1 },
    VSPEED: { enabled: true, row: 10, col: 1 },
    CURRENT: { enabled: true, row: 2, col: 23 },
    BATUSED: { enabled: true, row: 3, col: 23 },
    MESSAGES: { enabled: true, row: 13, col: 1 },
    ARMING: { enabled: true, row: 7, col: 12 },
  },
  Minimal: {
    BATTVOLT: { enabled: true, row: 0, col: 24 },
    FLTMODE: { enabled: true, row: 14, col: 12 },
    ARMING: { enabled: true, row: 7, col: 12 },
  },
};

interface OsdElementGridProps {
  elements: OsdElement[];
  activeScreen: number;
  saving: boolean;
  selectedDroneId: string | null;
  showCommitButton: boolean;
  clipboard: OsdElement[] | null;
  videoFormat: VideoFormat;
  onToggleElement: (id: string) => void;
  onScreenChange: (screen: number) => void;
  onLoadPreset: (name: string) => void;
  onCopyScreen: () => void;
  onPasteScreen: () => void;
  onFormatChange: (format: VideoFormat) => void;
  onSave: () => void;
  onCommitFlash: () => void;
  onReset: () => void;
}

export function OsdElementGrid({
  elements,
  activeScreen,
  saving,
  selectedDroneId,
  showCommitButton,
  clipboard,
  videoFormat,
  onToggleElement,
  onScreenChange,
  onLoadPreset,
  onCopyScreen,
  onPasteScreen,
  onFormatChange,
  onSave,
  onCommitFlash,
  onReset,
}: OsdElementGridProps) {
  return (
    <div className="w-[220px] border-r border-border-default bg-bg-secondary flex-shrink-0 flex flex-col overflow-hidden">
      <div className="px-3 py-3 border-b border-border-default">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
          <Layers size={12} />
          OSD Elements
        </h2>
      </div>

      {/* Screen selector */}
      <div className="flex border-b border-border-default">
        {[1, 2, 3, 4].map((screen) => (
          <button
            key={screen}
            onClick={() => onScreenChange(screen)}
            className={`flex-1 py-2 text-[10px] font-semibold cursor-pointer -mb-px border-b-2 ${
              activeScreen === screen
                ? "text-accent-primary border-accent-primary"
                : "text-text-tertiary hover:text-text-secondary border-transparent"
            }`}
          >
            OSD {screen}
          </button>
        ))}
      </div>

      {/* Copy/Paste + Format */}
      <div className="flex items-center gap-1 p-2 border-b border-border-default">
        <button
          onClick={onCopyScreen}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary border border-border-default cursor-pointer"
        >
          <Copy size={10} />
          Copy
        </button>
        <button
          onClick={onPasteScreen}
          disabled={!clipboard}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary border border-border-default cursor-pointer disabled:opacity-40"
        >
          <ClipboardPaste size={10} />
          Paste
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 bg-bg-tertiary p-0.5 rounded">
          {(["PAL", "NTSC"] as VideoFormat[]).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onFormatChange(fmt)}
              className={cn(
                "px-2 py-0.5 text-[10px] cursor-pointer rounded transition-colors",
                videoFormat === fmt
                  ? "bg-bg-secondary text-text-primary font-medium"
                  : "text-text-tertiary hover:text-text-secondary",
              )}
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {/* Preset buttons */}
      <div className="flex gap-1 p-2 border-b border-border-default">
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            onClick={() => onLoadPreset(name)}
            className="flex-1 px-2 py-1 text-[10px] text-text-secondary border border-border-default hover:text-text-primary hover:bg-bg-tertiary cursor-pointer"
          >
            {name}
          </button>
        ))}
      </div>

      {/* Element list */}
      <div className="flex-1 overflow-y-auto">
        {elements.map((el) => (
          <button
            key={el.id}
            onClick={() => onToggleElement(el.id)}
            className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left cursor-pointer ${
              el.enabled ? "text-text-primary" : "text-text-tertiary"
            } hover:bg-bg-tertiary`}
          >
            {el.enabled ? (
              <Eye size={12} className="text-accent-primary shrink-0" />
            ) : (
              <EyeOff size={12} className="shrink-0" />
            )}
            <span className="truncate">{el.label}</span>
            {el.enabled && (
              <span className="ml-auto text-[10px] text-text-tertiary font-mono">
                {el.row},{el.col}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="p-2 border-t border-border-default space-y-1">
        <button
          onClick={onSave}
          disabled={!selectedDroneId || saving}
          className="flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-semibold bg-accent-primary text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Save size={12} />
          {saving ? "Saving..." : "Save to FC"}
        </button>
        {showCommitButton && (
          <button
            onClick={onCommitFlash}
            className="flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs font-semibold text-text-secondary border border-accent-primary/50 hover:text-accent-primary hover:bg-accent-primary/10 cursor-pointer"
          >
            <HardDrive size={12} />
            Write to Flash
          </button>
        )}
        <button
          onClick={onReset}
          className="flex items-center justify-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary border border-border-default hover:text-text-primary hover:bg-bg-tertiary cursor-pointer"
        >
          <RotateCcw size={12} />
          Reset to Default
        </button>
      </div>
    </div>
  );
}
