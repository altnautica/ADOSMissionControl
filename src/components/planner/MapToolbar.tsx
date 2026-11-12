/**
 * @module MapToolbar
 * @description Floating vertical tool rail for the mission planner map.
 * Tools are grouped: select, waypoint split (W/K/J/O/R), pattern gallery,
 * draw split (P/C), marker split (Y/B/D), measure, then undo/redo, then
 * layers, offline area and shortcut help. Every tool is at most two clicks
 * away: a split button's main face arms its last-used tool, its chevron opens
 * a flyout listing the whole group with shortcuts.
 * @license GPL-3.0-only
 */
"use client";

import { forwardRef, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  MousePointer2, MapPin, Pentagon, Circle, Ruler, Undo2, Redo2, HelpCircle,
  ArrowUpFromLine, ArrowDownToLine, CircleDot, Crosshair, Flag, Target,
  Layers, CloudDownload, MapPinned, Shapes, ChevronRight,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PlannerTool } from "@/lib/types";
import { shortcutKeyForTool } from "@/lib/planner-shortcuts";
import { MAP_OVERLAY_Z } from "@/lib/map-overlay-z";
import { PatternGallery } from "./PatternGallery";
import { PlannerShortcutsHelp } from "./PlannerShortcutsHelp";

interface MapToolbarProps {
  activeTool: PlannerTool;
  onToolChange: (tool: PlannerTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleOverlays?: () => void;
  overlayPanelOpen?: boolean;
  /** The overlays panel is unavailable (the 3D view has no 2D layers). */
  overlaysDisabled?: boolean;
  onToggleDownload?: () => void;
  downloadPanelOpen?: boolean;
  /** The map has not reported its bounds yet, so there is no area to download. */
  downloadDisabled?: boolean;
}

// `labelKey` is a `planner` i18n key; the shortcut letter is derived from the
// single PLANNER_SHORTCUTS table so the rail, the help popover, and the palette
// never drift apart.
type ToolDef = { id: PlannerTool; icon: typeof MapPin; labelKey: string };

const SELECT_TOOL: ToolDef = { id: "select", icon: MousePointer2, labelKey: "shortcuts.select" };
const MEASURE_TOOL: ToolDef = { id: "measure", icon: Ruler, labelKey: "shortcuts.measure" };

const WAYPOINT_TOOLS: ToolDef[] = [
  { id: "waypoint", icon: MapPin, labelKey: "shortcuts.waypoint" },
  { id: "takeoff", icon: ArrowUpFromLine, labelKey: "shortcuts.takeoff" },
  { id: "land", icon: ArrowDownToLine, labelKey: "shortcuts.land" },
  { id: "loiter", icon: CircleDot, labelKey: "shortcuts.loiter" },
  { id: "roi", icon: Crosshair, labelKey: "shortcuts.roi" },
];

const DRAW_TOOLS: ToolDef[] = [
  { id: "polygon", icon: Pentagon, labelKey: "shortcuts.polygon" },
  { id: "circle", icon: Circle, labelKey: "shortcuts.circle" },
];

const MARKER_TOOLS: ToolDef[] = [
  { id: "rally", icon: Flag, labelKey: "shortcuts.rally" },
  { id: "poi", icon: MapPinned, labelKey: "shortcuts.poi" },
  { id: "datum", icon: Target, labelKey: "shortcuts.datum" },
];

const RailButton = forwardRef<
  HTMLButtonElement,
  {
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
    tooltip: string;
    expanded?: boolean;
    dataTool?: string;
  }
>(function RailButton({ active, disabled, onClick, children, tooltip, expanded, dataTool }, ref) {
  // `aria-disabled` rather than `disabled` keeps an unavailable control in the
  // tab order, so a keyboard operator can focus it and read why in its tooltip;
  // a natively disabled button is unfocusable and the reason unreachable.
  return (
    <Tooltip content={tooltip} position="right">
      <button
        ref={ref}
        type="button"
        onClick={disabled ? undefined : onClick}
        aria-disabled={disabled || undefined}
        // Icon-only control: the tooltip text doubles as the accessible name.
        aria-label={tooltip}
        aria-pressed={active ?? undefined}
        aria-expanded={expanded}
        data-tool={dataTool}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-pointer",
          disabled && "cursor-not-allowed opacity-30",
          disabled
            ? "text-text-secondary"
            : active
              ? "bg-accent-primary/20 text-accent-primary"
              : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
});

/**
 * A rail button standing for a group of tools. The face arms the group's
 * last-used tool; the strip on its right edge (or a right-click on the face)
 * opens a flyout listing every tool in the group with its shortcut. The strip
 * is 16 × 32 px on screen with a 32 × 48 px hit area.
 */
function SplitTool({
  tools,
  activeTool,
  onToolChange,
  groupLabel,
}: {
  tools: ToolDef[];
  activeTool: PlannerTool;
  onToolChange: (tool: PlannerTool) => void;
  groupLabel: string;
}) {
  const t = useTranslations("planner");
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [lastUsed, setLastUsed] = useState<PlannerTool>(tools[0].id);
  const groupActive = tools.some((tool) => tool.id === activeTool);
  // Follow the active tool whichever way it was armed (shortcut, flyout, face).
  if (groupActive && activeTool !== lastUsed) setLastUsed(activeTool);
  const face = tools.find((tool) => tool.id === lastUsed) ?? tools[0];

  return (
    <div
      ref={anchorRef}
      className="relative flex items-center"
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      <RailButton
        active={groupActive}
        onClick={() => onToolChange(face.id)}
        tooltip={`${t(face.labelKey)} (${shortcutKeyForTool(face.id)?.toUpperCase() ?? ""})`}
        dataTool={face.id}
      >
        <face.icon size={16} />
      </RailButton>
      <button
        type="button"
        aria-label={groupLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-8 w-4 items-center justify-center rounded-md cursor-pointer text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary focus-ring",
          // 48 × 48 hit area: 8 px above and below, 32 px out over the map
          // edge, never back over the face button on the left.
          "after:absolute after:-inset-y-2 after:left-0 after:-right-8",
          open && "text-text-primary",
        )}
      >
        <ChevronRight size={12} aria-hidden="true" />
      </button>
      <Popover anchorRef={anchorRef} open={open} onOpenChange={setOpen} side="right" align="start" ariaLabel={groupLabel}>
        <ul className="flex w-52 flex-col p-1">
          {tools.map((tool) => {
            const key = shortcutKeyForTool(tool.id);
            const active = tool.id === activeTool;
            return (
              <li key={tool.id}>
                <button
                  type="button"
                  data-tool={tool.id}
                  onClick={() => {
                    onToolChange(tool.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[12px] transition-colors cursor-pointer",
                    active
                      ? "bg-accent-primary/15 text-accent-primary"
                      : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
                  )}
                >
                  <tool.icon size={14} />
                  <span className="flex-1 truncate">{t(tool.labelKey)}</span>
                  {key && (
                    <kbd className="font-mono text-[11px] text-text-tertiary">{key.toUpperCase()}</kbd>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </div>
  );
}

/** A rail button that toggles an anchored popover. */
function PopoverTool({
  icon,
  tooltip,
  ariaLabel,
  children,
}: {
  icon: ReactNode;
  tooltip: string;
  ariaLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <RailButton ref={anchorRef} active={open} expanded={open} onClick={() => setOpen((v) => !v)} tooltip={tooltip}>
        {icon}
      </RailButton>
      <Popover anchorRef={anchorRef} open={open} onOpenChange={setOpen} side="right" align="start" ariaLabel={ariaLabel}>
        {children(() => setOpen(false))}
      </Popover>
    </>
  );
}

export function MapToolbar({
  activeTool,
  onToolChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onToggleOverlays,
  overlayPanelOpen,
  overlaysDisabled,
  onToggleDownload,
  downloadPanelOpen,
  downloadDisabled,
}: MapToolbarProps) {
  const t = useTranslations("planner");
  const single = (tool: ToolDef) => (
    <RailButton
      active={activeTool === tool.id}
      onClick={() => onToolChange(tool.id)}
      tooltip={`${t(tool.labelKey)} (${shortcutKeyForTool(tool.id)?.toUpperCase() ?? ""})`}
      dataTool={tool.id}
    >
      <tool.icon size={16} />
    </RailButton>
  );

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("rail.ariaLabel")}
      style={{ zIndex: MAP_OVERLAY_Z.panel }}
      className="absolute left-3 top-24 flex flex-col gap-0.5 rounded-lg border border-border-default bg-bg-secondary/90 p-1 backdrop-blur-sm"
    >
      {single(SELECT_TOOL)}
      <SplitTool tools={WAYPOINT_TOOLS} activeTool={activeTool} onToolChange={onToolChange} groupLabel={t("rail.waypointTools")} />
      <PopoverTool
        icon={<Shapes size={16} />}
        tooltip={`${t("rail.patterns")} (G)`}
        ariaLabel={t("rail.gallery.ariaLabel")}
      >
        {(close) => <PatternGallery onPicked={close} />}
      </PopoverTool>
      <SplitTool tools={DRAW_TOOLS} activeTool={activeTool} onToolChange={onToolChange} groupLabel={t("rail.drawTools")} />
      <SplitTool tools={MARKER_TOOLS} activeTool={activeTool} onToolChange={onToolChange} groupLabel={t("rail.markerTools")} />
      {single(MEASURE_TOOL)}

      <div className="my-0.5 h-px bg-border-default" />

      <RailButton disabled={!canUndo} onClick={onUndo} tooltip={t("undo")}>
        <Undo2 size={16} />
      </RailButton>
      <RailButton disabled={!canRedo} onClick={onRedo} tooltip={t("redo")}>
        <Redo2 size={16} />
      </RailButton>

      <div className="my-0.5 h-px bg-border-default" />

      {onToggleOverlays && (
        <RailButton active={overlayPanelOpen} disabled={overlaysDisabled} onClick={onToggleOverlays} tooltip={`${t("rail.layers")} (L)`}>
          <Layers size={16} />
        </RailButton>
      )}
      {onToggleDownload && (
        <RailButton
          active={downloadPanelOpen}
          disabled={downloadDisabled}
          onClick={onToggleDownload}
          tooltip={downloadDisabled ? t("offline.waitingForMap") : t("rail.offlineArea")}
        >
          <CloudDownload size={16} />
        </RailButton>
      )}
      <PopoverTool icon={<HelpCircle size={16} />} tooltip={t("rail.help.title")} ariaLabel={t("rail.help.title")}>
        {() => <PlannerShortcutsHelp />}
      </PopoverTool>
    </div>
  );
}
