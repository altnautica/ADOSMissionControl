/**
 * @module MapToolbar
 * @description Floating vertical tool dock for the mission planner map.
 * Provides tool selection (select, waypoint, polygon, circle, measure),
 * undo/redo, and clear-all actions.
 * @license GPL-3.0-only
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  MousePointer2, MapPin, Pentagon, Circle, Ruler,
  Undo2, Redo2, Trash2, HelpCircle, X,
  ArrowUpFromLine, ArrowDownToLine, CircleDot, Crosshair, Flag,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PlannerTool } from "@/lib/types";

interface MapToolbarProps {
  activeTool: PlannerTool;
  onToolChange: (tool: PlannerTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClearAll: () => void;
}

type ToolDef = { id: PlannerTool; icon: typeof MapPin; label: string; shortcut?: string };

const navTools: ToolDef[] = [
  { id: "select", icon: MousePointer2, label: "Select", shortcut: "V" },
];

const placementTools: ToolDef[] = [
  { id: "waypoint", icon: MapPin, label: "Waypoint", shortcut: "W" },
  { id: "takeoff", icon: ArrowUpFromLine, label: "Takeoff" },
  { id: "land", icon: ArrowDownToLine, label: "Land" },
  { id: "loiter", icon: CircleDot, label: "Loiter" },
  { id: "roi", icon: Crosshair, label: "ROI" },
  { id: "rally", icon: Flag, label: "Rally" },
];

const drawingTools: ToolDef[] = [
  { id: "polygon", icon: Pentagon, label: "Polygon", shortcut: "P" },
  { id: "circle", icon: Circle, label: "Circle", shortcut: "C" },
  { id: "measure", icon: Ruler, label: "Measure", shortcut: "M" },
];

const toolGroups: ToolDef[][] = [navTools, placementTools, drawingTools];

function ToolButton({
  active,
  disabled,
  onClick,
  children,
  tooltip,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tooltip: string;
}) {
  return (
    <Tooltip content={tooltip} position="right">
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded-md transition-colors cursor-pointer",
          "disabled:opacity-30 disabled:cursor-not-allowed",
          active
            ? "bg-accent-primary/20 text-accent-primary"
            : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function MapToolbar({
  activeTool,
  onToolChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClearAll,
}: MapToolbarProps) {
  const t = useTranslations("planner");
  return (
    <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-1 p-1 bg-bg-secondary/90 backdrop-blur-sm border border-border-default rounded-lg">
      {toolGroups.map((group, gi) => (
        <div key={gi} className="flex flex-col">
          {gi > 0 && <div className="h-px bg-border-default" />}
          {group.map((t) => (
            <ToolButton
              key={t.id}
              active={activeTool === t.id}
              onClick={() => onToolChange(t.id)}
              tooltip={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
            >
              <t.icon size={16} />
            </ToolButton>
          ))}
        </div>
      ))}

      <div className="h-px bg-border-default" />

      <ToolButton
        disabled={!canUndo}
        onClick={onUndo}
        tooltip={t("undo")}
      >
        <Undo2 size={16} />
      </ToolButton>
      <ToolButton
        disabled={!canRedo}
        onClick={onRedo}
        tooltip={t("redo")}
      >
        <Redo2 size={16} />
      </ToolButton>

      <div className="h-px bg-border-default" />

      <ToolButton onClick={onClearAll} tooltip={t("clearAll")}>
        <Trash2 size={16} />
      </ToolButton>

      <div className="h-px bg-border-default" />

      <ShortcutsHelpButton />
    </div>
  );
}

function ShortcutsHelpButton() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("planner");

  return (
    <>
      <ToolButton onClick={() => setOpen(true)} tooltip={t("keyboardShortcuts")}>
        <HelpCircle size={16} />
      </ToolButton>

      {open && (
        <div className="absolute left-12 top-0 z-[1001] w-52 bg-bg-secondary/95 backdrop-blur-sm border border-border-default rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono font-semibold text-text-primary">{t("keyboardShortcuts")}</span>
            <button onClick={() => setOpen(false)} className="text-text-tertiary hover:text-text-primary cursor-pointer">
              <X size={12} />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {[
              ["V", "Select tool"],
              ["W", "Waypoint tool"],
              ["P", "Polygon tool"],
              ["C", "Circle tool"],
              ["M", "Measure tool"],
              ["Cmd+Z", "Undo"],
              ["Cmd+Shift+Z", "Redo"],
              ["Del", "Delete selected"],
              ["Ctrl+Click", "Multi-select"],
              ["Shift+Click", "Range select"],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-text-secondary">{desc}</span>
                <kbd className="text-[9px] font-mono px-1 py-0.5 bg-bg-tertiary border border-border-default text-text-tertiary rounded">{key}</kbd>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
