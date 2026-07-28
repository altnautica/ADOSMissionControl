"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { LayoutGrid, LayoutDashboard, Network, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDroneManager } from "@/stores/drone-manager";
import { useFleetStore } from "@/stores/fleet-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useUiStore } from "@/stores/ui-store";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import { useFleetNodes } from "@/hooks/use-fleet-nodes";
import { DroneListPanel } from "@/components/dashboard/DroneListPanel";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { CommandFleetOverview } from "@/components/command/CommandFleetOverview";
import { NodesView } from "@/components/command/nodes-view/NodesView";
import { SwarmView } from "@/components/command/swarm-view/SwarmView";
import { NodeDetailPanel } from "@/components/dashboard/node-detail/NodeDetailPanel";
import { EmptyFleetState } from "@/components/dashboard/EmptyFleetState";

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const selectDrone = useDroneManager((s) => s.selectDrone);
  const fleetNodes = useFleetNodes();
  const dashboardView = useUiStore((s) => s.dashboardView);
  const setDashboardView = useUiStore((s) => s.setDashboardView);
  const immersiveMode = useUiStore((s) => s.immersiveMode);
  const exitImmersiveMode = useUiStore((s) => s.exitImmersiveMode);

  // A grid tile's expand/open maps the agent deviceId back to its registry-
  // projected fleet row (keyed by the canonical `node:<deviceId>`) and selects
  // it, opening the NodeDetailPanel — same as a sidebar click.
  function handleOpenAgent(deviceId: string) {
    const fleet = useFleetStore.getState().drones;
    // A direct-connect FC's grid tile carries its own managed id (fc:<random>)
    // as the deviceId — it is already a fleet-row id, so select it directly
    // rather than mapping it through nodeIdForDevice (which would double-prefix).
    if (fleet.some((d) => d.id === deviceId)) {
      selectDrone(deviceId);
      return;
    }
    const nodeId = nodeIdForDevice(deviceId);
    const match =
      fleet.find((d) => d.id === nodeId) ??
      fleet.find((d) => d.cloudDeviceId === deviceId);
    if (match) selectDrone(match.id);
  }

  // Reuse the sidebar's Add-a-Node dialog (local-first pairing).
  function handleOpenPairing() {
    useConnectDialogStore.getState().openDialog();
  }
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // The Flight Logs rail moved into the global right-hand RightRail (shell-wide,
  // alongside the MCP activity watch), so the Dashboard no longer owns it.

  // The fleet sidebar stays EXPANDED by default (and when a drone is opened) —
  // the operator collapses it manually via the chevron when they want the room.

  // Exit immersive mode if drone is deselected
  useEffect(() => {
    if (immersiveMode && selectedDroneId === null) {
      exitImmersiveMode();
    }
  }, [selectedDroneId, immersiveMode, exitImmersiveMode]);

  // Membership is the single unified hook (paired identities + live direct FCs),
  // so a directly-connected board and an offline paired node both keep the
  // dashboard non-empty and appear in the sidebar/grid.
  if (fleetNodes.length === 0) {
    return <EmptyFleetState />;
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {!immersiveMode && (
        <DroneListPanel collapsed={panelCollapsed} onToggleCollapse={() => setPanelCollapsed((p) => !p)} />
      )}
      {selectedDroneId ? (
        <NodeDetailPanel droneId={selectedDroneId} onClose={() => selectDrone(null)} />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* View toggle: node grid (live video tiles) vs map + status cards */}
          <div className="flex items-center justify-end px-3 py-2 border-b border-border-default bg-bg-secondary shrink-0">
            <div className="inline-flex rounded border border-border-default overflow-hidden">
              <button
                type="button"
                onClick={() => setDashboardView("grid")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors",
                  dashboardView === "grid"
                    ? "bg-accent-primary text-white"
                    : "bg-bg-secondary text-text-secondary hover:text-text-primary",
                )}
              >
                <LayoutGrid size={13} />
                {t("viewGrid")}
              </button>
              <button
                type="button"
                onClick={() => setDashboardView("overview")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors border-l border-border-default",
                  dashboardView === "overview"
                    ? "bg-accent-primary text-white"
                    : "bg-bg-secondary text-text-secondary hover:text-text-primary",
                )}
              >
                <LayoutDashboard size={13} />
                {t("viewOverview")}
              </button>
              <button
                type="button"
                onClick={() => setDashboardView("nodes")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors border-l border-border-default",
                  dashboardView === "nodes"
                    ? "bg-accent-primary text-white"
                    : "bg-bg-secondary text-text-secondary hover:text-text-primary",
                )}
              >
                <Network size={13} />
                {t("viewNodes")}
              </button>
              <button
                type="button"
                onClick={() => setDashboardView("swarm")}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors border-l border-border-default",
                  dashboardView === "swarm"
                    ? "bg-accent-primary text-white"
                    : "bg-bg-secondary text-text-secondary hover:text-text-primary",
                )}
              >
                <Users size={13} />
                {t("viewSwarm")}
              </button>
            </div>
          </div>

          {dashboardView === "grid" && (
            <CommandFleetOverview
              fleetNodes={fleetNodes}
              onOpenAgent={handleOpenAgent}
              onOpenPairing={handleOpenPairing}
            />
          )}
          {dashboardView === "overview" && <DashboardOverview />}
          {dashboardView === "nodes" && (
            <NodesView
              fleetNodes={fleetNodes}
              onOpenAgent={handleOpenAgent}
              onOpenPairing={handleOpenPairing}
            />
          )}
          {dashboardView === "swarm" && (
            <SwarmView
              fleetNodes={fleetNodes}
              onOpenAgent={handleOpenAgent}
              onOpenPairing={handleOpenPairing}
            />
          )}
        </div>
      )}
    </div>
  );
}
