"use client";

/**
 * @module command/PluginsTab
 * @description Per-drone plugin management surface on the Command page.
 *
 * The Agent tab's Extensions page, rendered from `AGENT_NAV_ITEMS`
 * (`agent-nav-items.tsx`). Renders the install affordance and the list of
 * installed plugins for the node the panel already resolved.
 *
 * Why this is its own component rather than a thin re-export of the
 * dashboard's DronePluginsTab: the dashboard version looks up the
 * target drone in `useFleetStore`, which is only populated by demo
 * mode. This adapter instead resolves its target drone from the
 * already-computed `SurfaceContext` that `NodeDetailPanel` derives once
 * per render — the same contract every other Agent sub-page reads —
 * rather than re-deriving from `agent-connection-store` / `pairing-store`
 * / `local-nodes-store`, which never resolve a ground-relayed drone.
 *
 * @license GPL-3.0-only
 */

import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { useSurfaceGate } from "@/hooks/use-surface-gate";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { agentGateFallback } from "./shared/agent-gate-fallback";
import { DronePluginsList } from "@/components/dashboard/drone-plugins/DronePluginsList";
import { InstallPluginButton } from "@/components/dashboard/drone-plugins/InstallPluginButton";
import { RegistryPluginGrid } from "@/components/dashboard/drone-plugins/RegistryPluginGrid";
import type { FleetDrone } from "@/lib/types";

export function PluginsTab({ ctx }: { ctx: SurfaceContext }) {
  const t = useTranslations("dronePlugins");
  const agentGate = useSurfaceGate("agent-online");

  // ctx.drone.id is the canonical `node:<deviceId>` selection id (the same
  // id NodeDetailPanel keys `drones.find` on); every downstream consumer
  // here — the Convex `deviceId` key, the plugin inventory store — is
  // keyed by the bare device id instead, the same distinction
  // NodeDetailPanel itself draws for `atlasDeviceId`. ctx.drone is
  // guaranteed non-null: NodeDetailPanel renders no surface until it
  // resolves one, and this tab's nav entry only shows when the agent is
  // reachable (`ctx.agentDeviceId !== null || ctx.relayReach !== null`),
  // so there is no "not connected" state left to handle here — a drone
  // reached directly (LAN or cloud) and one reached only through its
  // ground station's relay resolve identically.
  const activeDrone = useMemo<FleetDrone>(() => {
    const bareDeviceId = deviceIdFromNodeId(ctx.droneId) ?? ctx.droneId;
    return { ...ctx.drone, id: bareDeviceId };
  }, [ctx.drone, ctx.droneId]);

  const blocked = agentGateFallback(agentGate);
  if (blocked) return blocked;

  const droneName = activeDrone.name ?? activeDrone.id;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default bg-bg-secondary px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text-primary">
            {t("titleForDrone", { drone: droneName })}
          </h2>
          <p className="truncate text-xs text-text-tertiary">
            {t("subtitle")}
          </p>
        </div>
        <InstallPluginButton
          targetDevice={activeDrone}
          variant="secondary"
          label={t("installFromFile")}
        />
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-text-secondary">
              {t("installedSectionTitle")}
            </h3>
            <DronePluginsList
              agentId={activeDrone.id}
              emptyState={<InstalledEmptyState drone={activeDrone} />}
            />
          </section>
          <RegistryPluginGrid
            target={{
              _id: activeDrone.cloudDeviceId ?? activeDrone.id,
              deviceId: activeDrone.cloudDeviceId ?? activeDrone.id,
              name: activeDrone.name ?? activeDrone.id,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function InstalledEmptyState({ drone }: { drone: FleetDrone }) {
  const t = useTranslations("dronePlugins");
  return (
    <div className="rounded-md border border-dashed border-border-default p-6 text-center">
      <p className="text-sm text-text-primary">{t("emptyStateTitle")}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-text-tertiary">
        {t("emptyInstalledHint")}
      </p>
      <div className="mt-3 flex items-center justify-center gap-2">
        <InstallPluginButton
          targetDevice={drone}
          variant="secondary"
          label={t("installFromFile")}
        />
      </div>
    </div>
  );
}
