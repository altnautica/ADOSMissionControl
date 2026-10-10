"use client";

/**
 * @module plugins/PluginCockpitWidgetHost
 * @description Registers each installed extension's `cockpit.widget` panel
 * for a drone into the cockpit widget registry, so it renders in its declared
 * zone beside the built-in widgets (arrangeable and hideable like them).
 * Render-null: the registered widget renders the extension's sandboxed iframe
 * through a per-drone plugin host, and `<PluginSlot>` enforces the
 * `ui.slot.cockpit-widget` capability. Registrations are dropped on drone
 * switch and unmount.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";

import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import {
  registerCockpitWidget,
  unregisterCockpitWidget,
  type CockpitZone,
} from "@/lib/cockpit/widget-registry";
import {
  PluginHostProvider,
  type PluginSlotContribution,
} from "./PluginHostProvider";
import { PluginSlot } from "./PluginSlot";

const SLOT = "cockpit.widget" as const;

/** Zones a plugin widget may declare. */
const WIDGET_ZONES: ReadonlyArray<CockpitZone> = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

/** The zone a declared value names, `bottom-left` when absent or unknown. */
export function pluginWidgetZone(zone: string | undefined): CockpitZone {
  return WIDGET_ZONES.find((z) => z === zone) ?? "bottom-left";
}

/** The registry id of one plugin widget panel. */
export function pluginWidgetId(c: Pick<PluginSlotContribution, "pluginId" | "panelId">): string {
  return `plugin:${c.pluginId}:${c.panelId}`;
}

function PluginWidgetFrame({
  deviceId,
  contribution,
}: {
  deviceId: string;
  contribution: PluginSlotContribution;
}) {
  const list = useMemo(() => [{ ...contribution, slot: SLOT }], [contribution]);
  return (
    <PluginHostProvider deviceId={deviceId} contributions={list}>
      <PluginSlot
        name={SLOT}
        className="pointer-events-auto"
        iframeClassName="block h-40 w-64 rounded-lg border-0"
      />
    </PluginHostProvider>
  );
}

export function PluginCockpitWidgetHost({ droneId }: { droneId: string }) {
  const deviceId = deviceIdFromNodeId(droneId) ?? droneId;
  const contributions = usePluginContributions(deviceId, SLOT);

  useEffect(() => {
    const ids: string[] = [];
    for (const c of contributions) {
      const id = pluginWidgetId(c);
      ids.push(id);
      registerCockpitWidget({
        id,
        zone: pluginWidgetZone(c.zone),
        source: "plugin",
        arrangeable: true,
        title: c.title ?? c.panelId,
        render: () => <PluginWidgetFrame deviceId={deviceId} contribution={c} />,
      });
    }
    return () => ids.forEach(unregisterCockpitWidget);
  }, [contributions, deviceId]);

  return null;
}
