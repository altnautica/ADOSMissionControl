/**
 * @module components/layout/RightRail
 * @description The global right-hand mini-sidebar. A 40px collapsed rail with a
 * stacked set of options, each expanding a 384px panel to its left. It hosts the
 * new **MCP** activity watch (always available, shell-wide) and the migrated
 * **Logs** flight-log panel (shown when a drone is selected). Lifted out of the
 * Dashboard so the MCP feed keeps running while the MCP drives other routes. One
 * panel open at a time; a per-option animate-ping badge signals new activity.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Bot, ScrollText, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useLogActivityStore } from "@/stores/log-activity-store";
import { useMcpActivityStore } from "@/stores/mcp-activity-store";
import { DroneLogsPanel } from "@/components/drone-detail/DroneLogsPanel";
import { McpActivityPanel } from "@/components/mcp/watch/McpActivityPanel";

function RailButton({
  label,
  icon: Icon,
  active,
  hasNew,
  onClick,
  title,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  hasNew: boolean;
  onClick: () => void;
  title: string;
}) {
  const lit = active || hasNew;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="relative flex flex-col items-center gap-1 px-1 py-2 border-b border-border-default hover:bg-bg-tertiary transition-colors cursor-pointer group"
    >
      <Icon
        size={14}
        className={cn(
          "transition-colors",
          lit ? "text-accent-primary" : "text-text-tertiary group-hover:text-text-secondary",
        )}
      />
      <span
        className={cn(
          "text-[9px] font-semibold uppercase tracking-wider transition-colors",
          lit ? "text-accent-primary" : "text-text-tertiary group-hover:text-text-secondary",
        )}
      >
        {label}
      </span>
      {hasNew && (
        <span className="absolute top-1.5 right-1.5 flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-primary" />
        </span>
      )}
    </button>
  );
}

function PanelFrame({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="w-[384px] shrink-0 flex flex-col h-full border-l border-border-default bg-bg-secondary">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default flex-shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
          title={closeLabel}
          aria-label={closeLabel}
        >
          <ChevronRight size={14} />
        </button>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          {title}
        </span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}

export function RightRail() {
  const tDash = useTranslations("dashboard");
  const tMcp = useTranslations("mcp");
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const immersive = useUiStore((s) => s.immersiveMode);
  const open = useUiStore((s) => s.rightRailPanel);
  const setOpen = useUiStore((s) => s.setRightRailPanel);

  const mcpCount = useMcpActivityStore((s) => s.count);
  const logCount = useLogActivityStore((s) => s.counts[selectedDroneId ?? ""] ?? 0);
  // The "seen" baseline is snapshotted when a panel CLOSES (in the toggle
  // handler), so a closed panel only lights its badge for activity since it was
  // last watched. While a panel is open its badge is gated off by `open !== p`.
  const [mcpSeen, setMcpSeen] = useState(0);
  const [logSeen, setLogSeen] = useState(0);

  // Rebaseline the logs badge when the selected drone changes — React's blessed
  // "adjust state during render" pattern (no effect, no setState-in-effect). The
  // logCount selector already reflects the newly-selected drone here.
  const [prevDrone, setPrevDrone] = useState(selectedDroneId);
  if (prevDrone !== selectedDroneId) {
    setPrevDrone(selectedDroneId);
    setLogSeen(logCount);
  }

  // Deselecting the drone closes the (now targetless) logs panel. setRightRailPanel
  // is a store action, not React state, so this effect is not a setState cascade.
  useEffect(() => {
    if (open === "logs" && !selectedDroneId) setOpen(null);
  }, [open, selectedDroneId, setOpen]);

  if (immersive) return null;

  const hasNewMcp = open !== "mcp" && mcpCount > mcpSeen;
  const hasNewLogs = open !== "logs" && !!selectedDroneId && logCount > logSeen;

  // Every way a panel stops being shown (its rail button, its own close
  // button, switching to the other panel) snapshots what was seen, so the badge
  // stays quiet until new activity arrives.
  const markSeen = () => {
    if (open === "mcp") setMcpSeen(mcpCount);
    else if (open === "logs") setLogSeen(logCount);
  };
  const close = () => {
    markSeen();
    setOpen(null);
  };
  const toggle = (p: "mcp" | "logs") => {
    if (open === p) {
      close();
    } else {
      markSeen();
      setOpen(p);
    }
  };

  return (
    <div className="flex h-full shrink-0" data-mcp-rail>
      {open === "mcp" && (
        <PanelFrame
          title={tMcp("watch.title")}
          closeLabel={tMcp("watch.collapse")}
          onClose={close}
        >
          <McpActivityPanel />
        </PanelFrame>
      )}
      {open === "logs" && selectedDroneId && (
        <PanelFrame
          title={tDash("flightLogs")}
          closeLabel={tDash("collapseLogs")}
          onClose={close}
        >
          <DroneLogsPanel droneId={selectedDroneId} />
        </PanelFrame>
      )}
      <div className="w-10 shrink-0 flex flex-col h-full border-l border-border-default bg-bg-secondary">
        {selectedDroneId && (
          <RailButton
            label={tDash("logs")}
            icon={ScrollText}
            active={open === "logs"}
            hasNew={hasNewLogs}
            onClick={() => toggle("logs")}
            title={hasNewLogs ? tDash("newLogs") : tDash("expandLogs")}
          />
        )}
        <RailButton
          label={tMcp("watch.railLabel")}
          icon={Bot}
          active={open === "mcp"}
          hasNew={hasNewMcp}
          onClick={() => toggle("mcp")}
          title={tMcp("watch.railTooltip")}
        />
      </div>
    </div>
  );
}
