/**
 * @module plugins/FleetPluginSlot
 * @description The fleet-scoped (no-drone) analogue of the per-drone slot
 * hosts. Mounts a single fleet `<PluginHostProvider deviceId={null}>` wrapping
 * a `<PluginSlot>` fed by `useFleetPluginContributions(slot)`, so a plugin
 * installed at the GCS level (no specific drone) renders into a fleet UI slot:
 * settings.section, fc.tab, hardware.tab, mission.template, map.overlay, or
 * notification.channel.
 *
 * Each fleet slot brings its own provider (mirrors `VideoOverlayHost`), so the
 * six scattered surfaces (settings nav, FC configure nav, system hardware,
 * planner gallery, planner map, notification system) each host their slot
 * independently without forcing a single root provider. The provider's
 * `deviceId={null}` collapses to the stable `"fleet"` subtree key, so the host
 * is a single long-lived host (no per-drone teardown).
 *
 * Inert until a plugin contributes: the slot renders nothing (or the supplied
 * `emptyState`) when the fleet producer yields no contribution for the slot.
 * The `<PluginSlot>` capability-gate (`ui.slot.<id>`) still applies, so a
 * contribution missing its slot cap is dropped with a one-shot toast.
 *
 * For a LAN-only operator (signed out) the GCS has no fleet-wide install
 * record of a node-installed plugin, so the slot also mounts the same slot's
 * contributions from every LAN-paired node, one keyed per-node host each. A
 * plugin installed on a node therefore lights its fleet surfaces (a map
 * overlay, a settings section) without a cloud account.
 *
 * @license GPL-3.0-only
 */

"use client";

import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { PluginSlot } from "@/components/plugins/PluginSlot";
import { PluginHostProvider } from "@/components/plugins/PluginHostProvider";
import { useFleetPluginContributions } from "@/hooks/use-fleet-plugin-contributions";
import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import type { PluginSlotName } from "@/lib/plugins/types";
import { isDemoMode } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

interface FleetPluginSlotProps {
  /** Which fleet slot to host. */
  name: PluginSlotName;
  /** Rendered when no plugin contributes to this fleet slot. */
  emptyState?: ReactNode;
  /** Class on the slot wrapper. */
  className?: string;
  /** Class on each mounted iframe. Slot owners control sizing. */
  iframeClassName?: string;
}

/**
 * Host one fleet slot. Resolves the fleet contributions for `name`, mounts a
 * fleet-scoped provider, and renders a `<PluginSlot>` over them, plus one
 * per-node host for each LAN-paired node when signed out. Renders the
 * `emptyState` (or nothing) when no plugin contributes.
 */
export function FleetPluginSlot({
  name,
  emptyState,
  className,
  iframeClassName,
}: FleetPluginSlotProps) {
  const contributions = useFleetPluginContributions(name);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const lanNodeIds = useLocalNodesStore(
    useShallow((s) => s.nodes.filter((n) => n.hostname && n.apiKey).map((n) => n.deviceId)),
  );
  const lanNodes = !isAuthenticated && !isDemoMode() ? lanNodeIds : [];

  // No fleet contribution and no node to ask — stay mute (or show the host's
  // empty copy).
  if (contributions.length === 0 && lanNodes.length === 0) return <>{emptyState}</>;

  return (
    <>
      {contributions.length > 0 ? (
        <PluginHostProvider deviceId={null} contributions={contributions}>
          <PluginSlot
            name={name}
            contributions={contributions}
            className={className}
            iframeClassName={iframeClassName}
          />
        </PluginHostProvider>
      ) : null}
      {lanNodes.map((deviceId) => (
        <LanNodeSlot
          key={deviceId}
          deviceId={deviceId}
          name={name}
          className={className}
          iframeClassName={iframeClassName}
        />
      ))}
    </>
  );
}

/** One LAN-paired node's contributions to a fleet slot. */
function LanNodeSlot({
  deviceId,
  name,
  className,
  iframeClassName,
}: {
  deviceId: string;
  name: PluginSlotName;
  className?: string;
  iframeClassName?: string;
}) {
  const contributions = usePluginContributions(deviceId, name);
  if (contributions.length === 0) return null;
  return (
    <PluginHostProvider deviceId={deviceId} contributions={contributions}>
      <PluginSlot
        name={name}
        contributions={contributions}
        className={className}
        iframeClassName={iframeClassName}
      />
    </PluginHostProvider>
  );
}
