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
import {
  GsFreshnessBadge,
  useGsSliceFreshness,
} from "@/components/command/shared/gs-slice-freshness";

export function MeshHealthCard() {
  const t = useTranslations("hardware.mesh");
  const health = useGroundStationStore((s) => s.mesh.health);
  const error = useGroundStationStore((s) => s.mesh.error);
  const fetchedAt = useGroundStationStore((s) => s.mesh.fetchedAt);
  // The gateway events stream updates this, so it is the gateway the table
  // shows too; the health snapshot's copy goes stale after a failover.
  const selectedGateway = useGroundStationStore((s) => s.mesh.selectedGateway);
  const freshness = useGsSliceFreshness(fetchedAt);

  if (!health) {
    return (
      <div className="p-4 bg-bg-primary border border-border-default/40">
        <div className="text-sm text-text-tertiary italic">{t("notUp")}</div>
      </div>
    );
  }

  // A failed load or an old snapshot is not a current reading: no green
  // "Healthy" on data the node is no longer confirming.
  const current = freshness === "fresh" && !error;

  return (
    <div
      className={`p-4 bg-bg-primary border border-border-default/40 flex flex-col gap-2 ${
        current ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-text-primary">{t("title")}</div>
          <GsFreshnessBadge freshness={error && freshness === "fresh" ? "stale" : freshness} />
        </div>
        <div
          className={
            !current
              ? "text-xs uppercase tracking-wider text-text-tertiary"
              : health.partition
                ? "text-xs uppercase tracking-wider text-status-error"
                : "text-xs uppercase tracking-wider text-status-success"
          }
        >
          {!current ? t("healthUnknown") : health.partition ? t("partitioned") : t("healthy")}
        </div>
      </div>
      {error ? <div className="text-xs text-status-error">{error}</div> : null}
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
            {selectedGateway ?? t("noGateway")}
          </div>
        </div>
      </div>
    </div>
  );
}
