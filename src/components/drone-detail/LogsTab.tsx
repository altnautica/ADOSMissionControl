"use client";

/**
 * @module drone-detail/LogsTab
 * @description The unified Logs surface: one tab that switches between two
 * sub-views — "Flights" (the GCS-side flight-record review) and "Recorder"
 * (the durable on-device Black Box log + telemetry store). A drone shows both;
 * ground-station and compute nodes do not fly, so they render only the
 * Recorder. The Flights view reads the GCS history store and works without a
 * paired agent, while the Recorder view self-gates to its agent-online
 * fallback, so the merged tab degrades gracefully on an FC-only drone.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { DroneFlightsTab } from "@/components/drone-detail/DroneFlightsTab";
import { BlackBoxTab } from "@/components/command/BlackBoxTab";
import { Px4EventsFeed } from "@/components/drone-detail/Px4EventsFeed";
import { useDroneManager } from "@/stores/drone-manager";

type LogsView = "flights" | "recorder" | "events";

interface LogsTabProps {
  droneId: string;
  /** The device id of the node's agent; the Recorder reads that node's store.
   * Null for a node with no agent identity. */
  nodeDeviceId: string | null;
  /** Show the Flights sub-view. Only a drone profile flies; ground-station and
   * compute nodes pass false and render the Recorder view alone. */
  showFlights?: boolean;
}

export function LogsTab({ droneId, nodeDeviceId, showFlights = false }: LogsTabProps) {
  const t = useTranslations("dronePanel.logsViews");
  const [view, setView] = useState<LogsView>(
    showFlights ? "flights" : "recorder",
  );
  // PX4 replaced STATUSTEXT with structured events — offer a decoded Events
  // view for a PX4 flight controller.
  const isPx4 = useDroneManager(
    (s) => s.drones.get(droneId)?.vehicleInfo.firmwareType === "px4",
  );

  // No Flights sub-view to switch to: render the Recorder body directly with
  // no switcher chrome (ground-station / compute nodes).
  if (!showFlights) {
    return <BlackBoxTab nodeDeviceId={nodeDeviceId} />;
  }

  const views: LogsView[] = isPx4
    ? ["flights", "events", "recorder"]
    : ["flights", "recorder"];

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      <div
        role="tablist"
        aria-label={t("switcherLabel")}
        className="flex items-center gap-1 px-3 py-1.5 border-b border-border-default bg-bg-secondary flex-shrink-0"
      >
        {views.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
              view === v
                ? "bg-bg-tertiary text-accent-primary"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {t(v)}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {view === "flights" ? (
          <DroneFlightsTab droneId={droneId} />
        ) : view === "events" ? (
          <Px4EventsFeed />
        ) : (
          <BlackBoxTab nodeDeviceId={nodeDeviceId} />
        )}
      </div>
    </div>
  );
}
