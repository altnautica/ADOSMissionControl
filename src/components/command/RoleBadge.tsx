"use client";

/**
 * @module RoleBadge
 * @description Top-bar pill showing the ground-station role and mesh id.
 * Visible while the selected node is the attached ground station (its agent
 * profile is `ground_station`); hidden for any other selection, including a
 * second ground station, so no node wears another node's role. Tooltip on hover surfaces mesh_id and peer
 * count when the node is on a mesh.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ROLE_COLORS: Record<string, string> = {
  direct: "bg-text-tertiary/15 text-text-secondary",
  relay: "bg-accent-primary/20 text-accent-primary",
  receiver: "bg-status-success/20 text-status-success",
  unset: "bg-status-warning/20 text-status-warning",
};

export function RoleBadge() {
  const t = useTranslations("hardware.role");
  const profile = useGroundStationStore((s) => s.status.profile);
  const roleInfo = useGroundStationStore((s) => s.role.info);
  const meshHealth = useGroundStationStore((s) => s.mesh.health);

  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const selectedProfile = useNodeRegistryStore((s) =>
    selectedId ? (s.nodes[selectedId]?.presence.profile ?? null) : null,
  );
  // The ground-station store describes the attached node only, so the role
  // shows only while that connection is the selected node's.
  const directAgent = useNodeDirectAgent(deviceIdFromNodeId(selectedId));

  if (profile !== "ground_station") return null;
  if (!selectedId || selectedProfile !== "ground-station") return null;
  if (!directAgent) return null;

  const role = roleInfo?.current ?? "unset";

  // Mesh id and peer count come only from a mesh-health reading; with none,
  // neither is known and neither is shown.
  const tooltipParts: string[] = [t(role)];
  if ((role === "relay" || role === "receiver") && meshHealth) {
    if (meshHealth.mesh_id) tooltipParts.push(`mesh: ${meshHealth.mesh_id}`);
    tooltipParts.push(`peers: ${meshHealth.peer_count}`);
  }

  return (
    <Tooltip content={tooltipParts.join(" · ")} position="bottom">
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
          ROLE_COLORS[role] ?? ROLE_COLORS.unset,
        )}
      >
        {t(role)}
      </span>
    </Tooltip>
  );
}
