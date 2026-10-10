"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tabs, tabButtonId } from "@/components/ui/tabs";
import { useDroneManager } from "@/stores/drone-manager";
import { resolveFleetRowId } from "@/lib/nodes/fleet-row";
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

/**
 * Consumes a Settings "Install on a node…" hand-off (`/?preselect=<pluginId>`):
 * opens the selected node's Agent → Extensions page with that plugin revealed
 * in its catalog, then drops the parameter so a reload does not repeat it.
 * Its own component under a Suspense boundary because reading search params
 * opts the subtree out of static rendering.
 */
function PreselectHandoff() {
  const preselect = useSearchParams()?.get("preselect") ?? null;
  const router = useRouter();
  useEffect(() => {
    if (!preselect) return;
    const ui = useUiStore.getState();
    ui.setPendingDetailTab("agent");
    ui.setPendingAgentPanel("plugins");
    ui.setPendingRegistryPluginId(preselect);
    router.replace("/");
  }, [preselect, router]);
  return null;
}

const DASHBOARD_VIEWS = ["grid", "overview", "nodes", "swarm"] as const;
const DASHBOARD_VIEW_PANEL = "dashboard-view-panel";

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
  // projected fleet row and selects it, opening the NodeDetailPanel — same as
  // a sidebar click.
  function handleOpenAgent(deviceId: string) {
    const rowId = resolveFleetRowId(deviceId);
    if (rowId) selectDrone(rowId);
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
      <Suspense fallback={null}>
        <PreselectHandoff />
      </Suspense>
      {!immersiveMode && (
        <DroneListPanel collapsed={panelCollapsed} onToggleCollapse={() => setPanelCollapsed((p) => !p)} />
      )}
      {selectedDroneId ? (
        <NodeDetailPanel droneId={selectedDroneId} onClose={() => selectDrone(null)} />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* View switch: node grid (live video tiles), map + status cards,
              node table, swarm. */}
          <Tabs
            label={t("viewSwitchLabel")}
            activeTab={dashboardView}
            onChange={(id) => {
              const view = DASHBOARD_VIEWS.find((v) => v === id);
              if (view) setDashboardView(view);
            }}
            tabs={[
              { id: "grid", label: t("viewGrid"), panelId: DASHBOARD_VIEW_PANEL },
              { id: "overview", label: t("viewOverview"), panelId: DASHBOARD_VIEW_PANEL },
              { id: "nodes", label: t("viewNodes"), panelId: DASHBOARD_VIEW_PANEL },
              { id: "swarm", label: t("viewSwarm"), panelId: DASHBOARD_VIEW_PANEL },
            ]}
            className="justify-end px-3 bg-bg-secondary"
          />
          <div
            role="tabpanel"
            id={DASHBOARD_VIEW_PANEL}
            aria-labelledby={tabButtonId(dashboardView)}
            className="flex-1 flex flex-col overflow-hidden min-h-0"
          >
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
        </div>
      )}
    </div>
  );
}
