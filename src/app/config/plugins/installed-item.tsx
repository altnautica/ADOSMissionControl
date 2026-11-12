"use client";

/**
 * @module config/plugins/installed-item
 * @description One row of Settings › Extensions' installed-by-node list: the
 * shared lifecycle pill, and a link to where the install is managed (the
 * cloud detail page, or the node's own Agent › Extensions).
 *
 * @license GPL-3.0-only
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  DronePluginStatusPill,
  type DronePluginStatusLabel,
} from "@/components/dashboard/drone-plugins/DronePluginStatusPill";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useDroneManager } from "@/stores/drone-manager";
import { useFleetDrones } from "@/stores/node-registry/use-fleet-drones";
import { useUiStore } from "@/stores/ui-store";

const PILL_LABELS: ReadonlySet<string> = new Set<DronePluginStatusLabel>([
  "running",
  "enabled",
  "disabled",
  "crashed",
  "installed",
]);

/** The shared lifecycle pill's label for a raw install status; anything it
 * has no word for (a removed or unknown state) reads as disabled. */
export function pillLabelFor(status: string): DronePluginStatusLabel {
  return PILL_LABELS.has(status) ? (status as DronePluginStatusLabel) : "disabled";
}

/** One row in the fleet-wide installed-by-node table (cloud + local-first merged). */
export interface InstalledRow {
  /** Stable list key. */
  key: string;
  /** Convex install id when this came from the cloud (links to detail). */
  cloudId?: string;
  pluginId: string;
  name: string;
  version: string;
  status: string;
  /** Where it landed: a drone wire id, or null for a GCS-level install. */
  deviceId: string | null;
}

export function InstalledItem({ install }: { install: InstalledRow }) {
  const t = useTranslations("plugins");
  const router = useRouter();
  const selectDrone = useDroneManager((s) => s.selectDrone);
  const fleetNodeId = useFleetDrones(
    (drones) => drones.find((d) => d.cloudDeviceId === install.deviceId)?.id ?? null,
  );
  const scopeLabel = install.deviceId ? t("scopeDrone") : t("scopeGcs");
  const body = (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {install.name}
          </span>
          <span className="text-xs text-text-tertiary">v{install.version}</span>
        </div>
        <code className="block truncate text-xs text-text-tertiary">
          {install.pluginId}
        </code>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="rounded-md border border-border-default bg-bg-tertiary px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
          {scopeLabel}
        </span>
        <DronePluginStatusPill label={pillLabelFor(install.status)} />
      </div>
    </div>
  );
  // Cloud rows link to their detail page (permission grant/revoke, events).
  // A node row without one opens that node's Agent › Extensions with the row
  // revealed, where it is enabled or removed. A GCS-only install has no node.
  if (install.cloudId) {
    return (
      <Link
        href={`/config/plugins/${install.cloudId}`}
        className="block transition-colors hover:bg-bg-tertiary"
      >
        {body}
      </Link>
    );
  }
  if (!install.deviceId) return body;
  const deviceId = install.deviceId;
  const openOnNode = () => {
    selectDrone(fleetNodeId ?? nodeIdForDevice(deviceId));
    const ui = useUiStore.getState();
    ui.setPendingDetailTab("agent");
    ui.setPendingAgentPanel("plugins");
    ui.setPendingPluginId(install.pluginId);
    router.push("/");
  };
  return (
    <button
      type="button"
      onClick={openOnNode}
      className="block w-full text-left transition-colors hover:bg-bg-tertiary"
    >
      {body}
    </button>
  );
}
