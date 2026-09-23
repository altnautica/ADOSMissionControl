"use client";

import {
  Eye, EyeOff, Save, RotateCcw,
  Layers, HardDrive, Copy, ClipboardPaste,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OSD_SCREENS, PRESETS, type OsdElement, type VideoFormat } from "./ap-osd-elements";

interface OsdElementGridProps {
  elements: OsdElement[];
  activeScreen: number;
  saving: boolean;
  selectedDroneId: string | null;
  hasRamWrites: boolean;
  /** False when the screen's OSDn_ENABLE is 0 on the vehicle. */
  screenEnabled: boolean | null;
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
  hasRamWrites,
  screenEnabled,
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
        {OSD_SCREENS.map((screen) => (
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
      {screenEnabled === false && (
        <p className="px-3 py-2 text-[10px] text-status-warning border-b border-border-default">
          OSD{activeScreen}_ENABLE is off on the vehicle; this screen is not shown in flight.
        </p>
      )}

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
        {hasRamWrites && (
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
