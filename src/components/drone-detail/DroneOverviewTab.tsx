"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TelemetryReadout } from "@/components/flight/TelemetryReadout";
import { ActionsPanel } from "@/components/flight/ActionsPanel";
import { CompactInfoCards } from "@/components/flight/CompactInfoCards";
import { RcInputCard } from "@/components/command/shared/RcInputCard";
import { StatusTextCard } from "@/components/command/shared/StatusTextCard";
import type { FleetDrone } from "@/lib/types";

const OverviewHud = dynamic(
  () => import("@/components/flight/OverviewHud").then((m) => m.OverviewHud),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#0a1428] border border-border-default flex items-center justify-center">
        <span className="text-[10px] font-mono text-text-tertiary">Loading HUD...</span>
      </div>
    ),
  }
);

const OverviewMap = dynamic(
  () => import("@/components/flight/OverviewMap").then((m) => m.OverviewMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full bg-[#0a0a0a] border border-border-default flex items-center justify-center">
        <span className="text-[10px] font-mono text-text-tertiary">Loading Map...</span>
      </div>
    ),
  }
);

interface DroneOverviewTabProps {
  drone: FleetDrone;
  /**
   * Render the RC channel card here. RC state gets exactly one home: the
   * RC/ELRS tab when the node advertises a CRSF lane, otherwise this card.
   * It used to render on Status as well, sourced differently and gated
   * differently, so an operator debugging "my sticks aren't reaching the
   * aircraft" had two readings and nothing saying which was authoritative.
   */
  showRcCard?: boolean;
}

/**
 * The drone "Flight" tab: the ONE live-telemetry surface. Instruments, the
 * vehicle readouts, the actions and the map, plus the FC message stream and
 * sensor health that used to sit on Status beside a static summary of the
 * same vehicle.
 *
 * The piloting cockpit (video / HUD / skill bar) is its own tab, so this
 * surface carries no video, no sub-tab toolbar and no immersive/record
 * controls; the node home (identity, reach, the companion band) is Status.
 */
export function DroneOverviewTab({
  drone,
  showRcCard = false,
}: DroneOverviewTabProps) {
  const [telemetryCollapsed, setTelemetryCollapsed] = useState(false);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left column: HUD + Telemetry + Actions + Info (which carries the
          sensor health) + the FC message readout that moved off Status. */}
      {!telemetryCollapsed && (
        <div className="w-[22rem] shrink-0 flex flex-col overflow-y-auto border-r border-border-default">
          <div className="h-60 shrink-0">
            <OverviewHud />
          </div>
          <TelemetryReadout />
          <ActionsPanel />
          <CompactInfoCards drone={drone} />
          <div className="flex flex-col gap-2 p-2">
            {showRcCard && <RcInputCard />}
            <StatusTextCard />
          </div>
        </div>
      )}

      {/* Right column: the map, with a left-edge collapse handle for the panel. */}
      <div className="relative flex-1 flex flex-col overflow-hidden min-w-0">
        <button
          onClick={() => setTelemetryCollapsed((c) => !c)}
          className="absolute top-1/2 left-0 z-[600] flex h-10 w-4 -translate-y-1/2 items-center justify-center rounded-r border border-l-0 border-border-default bg-bg-secondary/85 text-text-tertiary backdrop-blur-sm transition-colors hover:text-text-primary"
          title={telemetryCollapsed ? "Show telemetry panel" : "Hide telemetry panel"}
          aria-label={telemetryCollapsed ? "Show telemetry panel" : "Hide telemetry panel"}
        >
          {telemetryCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
        <div className="flex-1 min-h-0">
          <OverviewMap />
        </div>
      </div>
    </div>
  );
}
