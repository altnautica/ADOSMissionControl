"use client";

/**
 * @module DroneContextRail
 * @description Collapsible right sidebar showing mini-map, video, telemetry, and mission progress.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniMapView } from "./MiniMapView";
import { MiniVideoView } from "./MiniVideoView";
import { TelemetryStrip } from "./TelemetryStrip";
import { MissionProgressBar } from "./MissionProgressBar";

export function DroneContextRail() {
  const t = useTranslations("command");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "border-l border-border-default bg-bg-secondary flex flex-col transition-all duration-200 shrink-0",
        collapsed ? "w-10" : "w-[200px]"
      )}
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-center h-8 border-b border-border-default hover:bg-bg-tertiary transition-colors"
        title={collapsed ? t("expandRail") : t("collapseRail")}
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-2 p-2 overflow-y-auto flex-1">
          <MiniVideoView />
          <MiniMapView />
          <TelemetryStrip />
          <MissionProgressBar />
        </div>
      )}
    </div>
  );
}
