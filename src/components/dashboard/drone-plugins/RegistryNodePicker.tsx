"use client";

/**
 * @module RegistryNodePicker
 * @description The Settings -> Extensions "Install on a node…" picker for one
 * registry plugin. Lists every node whose own Extensions page can accept an
 * install: a node the GCS reaches directly (`cloudDeviceId`) or through its
 * ground station's relay. Picking one selects that node and hands off to the
 * dashboard with the plugin flagged for preselection (`/?preselect=`), which
 * opens the node's Agent -> Extensions page with the card revealed.
 *
 * Mounted only while the picker is open, so the fleet subscription (the
 * projector replaces the fleet array on telemetry updates) costs nothing on
 * the per-node surface or on a closed card.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { resolveRelayReach } from "@/lib/nodes/relay-reach";
import type { FleetDrone } from "@/lib/types";

export function RegistryNodePicker({
  pluginId,
  onPicked,
}: {
  pluginId: string;
  onPicked: () => void;
}) {
  const t = useTranslations("pluginRegistry.browse");
  const router = useRouter();
  const drones = useFleetStore((s) => s.drones);
  const selectDrone = useDroneManager((s) => s.selectDrone);

  const eligibleNodes = useMemo<FleetDrone[]>(
    () =>
      drones.filter((d) => {
        const agentDeviceId = d.cloudDeviceId ?? null;
        if (agentDeviceId !== null) return true;
        return (
          resolveRelayReach({
            agentDeviceId,
            reachedVia: d.reachedVia,
            droneDeviceId: d.id,
          }) !== null
        );
      }),
    [drones],
  );

  function handlePickNode(node: FleetDrone) {
    onPicked();
    selectDrone(node.id);
    router.push(`/?preselect=${encodeURIComponent(pluginId)}`);
  }

  return (
    <div
      className="space-y-1 rounded-md border border-border-default bg-bg-tertiary p-2"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="px-1 text-[11px] font-medium text-text-tertiary">
        {t("card.pickNodeHeading")}
      </p>
      {eligibleNodes.length === 0 ? (
        <p className="px-1 text-[11px] text-text-tertiary">
          {t("card.pickNodeEmpty")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {eligibleNodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePickNode(node);
                }}
                className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-bg-primary"
              >
                {node.name ?? node.id}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
