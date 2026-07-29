"use client";

/**
 * @module DronePluginsTab
 * @description Top-level body of the per-drone Plugins tab inside
 * `DroneDetailPanel.tsx`. Owns the header, the install affordance, and
 * the list. The list reads from `cmdPlugins:listForDevice` and renders
 * one card per install row. The install button pre-fills the target
 * drone so the drop stage of the install dialog is skipped.
 *
 * Primary entry point for managing plugins installed on a specific
 * drone. The Settings -> Plugins page exists for fleet rollouts;
 * day-to-day install / configure / enable / disable happens here on
 * the drone itself.
 *
 * The tab is always present on every drone. A drone with zero plugins
 * shows the tab with an empty state and a primary install button.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { useFleetStore } from "@/stores/fleet-store";
import type { FleetDrone } from "@/lib/types";
import { resolveRelayReach, type RelayReach } from "@/lib/nodes/relay-reach";

import { DronePluginsList } from "./DronePluginsList";
import { InstallPluginButton } from "./InstallPluginButton";
import { RegistryPluginGrid } from "./RegistryPluginGrid";

interface DronePluginsTabProps {
  /** Drone the panel is scoped to. */
  agentId: string;
  /** Registry plugin id to scroll to / highlight on mount, set by a
   * Settings-surface "Install on a node…" hand-off (`RegistryPluginCard`).
   * Optional and unused until a caller wires a `?preselect=` query param
   * through — kept as a plain prop rather than reading `next/navigation`
   * directly so this component stays router-agnostic and test-friendly. */
  preselectPluginId?: string | null;
}

export function DronePluginsTab({
  agentId,
  preselectPluginId = null,
}: DronePluginsTabProps) {
  const t = useTranslations("dronePlugins");
  const drone = useFleetStore((s) =>
    s.drones.find((d) => d.id === agentId),
  );

  // Header label that names the drone so the operator stays oriented
  // when they are jumping between drones in quick succession.
  const droneName = useMemo(
    () => drone?.name ?? agentId,
    [drone, agentId],
  );

  // This node's agent is reachable directly (`agentDeviceId !== null`) or
  // through its ground station's relay-proxy (`relayReach !== null`) — the
  // same reach gate `NodeDetailPanel.tsx` / `agent-nav-items.tsx` use to
  // decide whether the per-node Extensions tab shows at all. A relay-only
  // node has no `cloudDeviceId`, so anything that still fell back to
  // `drone.id` (the node-shaped id) for the registry grid's device-keyed
  // install-lookup query would resolve the wrong key.
  const agentDeviceId = drone?.cloudDeviceId ?? null;
  const relayReach: RelayReach | null = resolveRelayReach({
    agentDeviceId,
    reachedVia: drone?.reachedVia,
    droneDeviceId: drone?.id ?? agentId,
  });
  const agentReachable = agentDeviceId !== null || relayReach !== null;

  if (!drone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-text-secondary">
          {t("droneNotFound", { id: agentId })}
        </p>
      </div>
    );
  }

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
          targetDevice={drone}
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
              agentId={agentId}
              emptyState={<InstalledEmptyState drone={drone} />}
            />
          </section>
          <RegistryPluginGrid
            target={{
              _id: relayReach?.peerDeviceId ?? (drone.cloudDeviceId ?? drone.id),
              deviceId:
                relayReach?.peerDeviceId ?? (drone.cloudDeviceId ?? drone.id),
              name: drone.name ?? drone.id,
            }}
            preselectPluginId={agentReachable ? preselectPluginId : null}
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
