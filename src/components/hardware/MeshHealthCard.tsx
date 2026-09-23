"use client";

/**
 * @module MeshHealthCard
 * @description batman-adv health summary: mesh id, peer count, partition
 * indicator, selected gateway. Renders an empty state when mesh is down
 * or when the role is direct.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";

export function MeshHealthCard() {
  const t = useTranslations("hardware.mesh");
  const health = useGroundStationStore((s) => s.mesh.health);

  if (!health) {
    return (
      <div className="p-4 bg-bg-primary border border-border-default/40">
        <div className="text-sm text-text-tertiary italic">{t("notUp")}</div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-bg-primary border border-border-default/40 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-text-primary">{t("title")}</div>
        <div
          className={
            health.partition
              ? "text-xs uppercase tracking-wider text-status-error"
              : "text-xs uppercase tracking-wider text-status-success"
          }
        >
          {health.partition ? t("partitioned") : t("healthy")}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <div className="text-text-tertiary uppercase tracking-wider">
            {t("meshId")}
          </div>
          <div className="font-mono text-text-primary">{health.mesh_id ?? "--"}</div>
        </div>
        <div>
          <div className="text-text-tertiary uppercase tracking-wider">
            {t("peers")}
          </div>
          <div className="font-mono text-text-primary">{health.peer_count}</div>
        </div>
        <div>
          <div className="text-text-tertiary uppercase tracking-wider">
            {t("selectedGateway")}
          </div>
          <div className="font-mono text-text-primary">
            {health.selected_gateway ?? t("noGateway")}
          </div>
        </div>
      </div>
    </div>
  );
}
