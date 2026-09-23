"use client";

/**
 * @module RoleBadge
 * @description Top-bar pill showing the ground-station role and mesh id.
 * Always visible when the agent profile is `ground_station`; hidden when
 * the profile is `drone`, `auto`, or `unconfigured`. Tooltip on hover
 * surfaces mesh_id and peer count when the node is on a mesh.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";
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

  if (profile !== "ground_station") return null;

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
