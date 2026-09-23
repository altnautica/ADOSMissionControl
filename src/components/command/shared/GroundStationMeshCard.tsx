"use client";

/**
 * @module GroundStationMeshCard
 * @description Compact mesh-state card for the GroundStationOverview.
 * Shows role + mesh health (peer count, partition state, mesh id).
 *
 * Role and mesh are separate reads with their own refresh stamps. A role that
 * was never read renders no role and no capability verdict, and a mesh health
 * that was never read renders every field unknown: an initial default is not
 * the node saying "unset", "not capable" or "down".
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { GsFreshnessBadge, useGsSliceFreshness } from "./gs-slice-freshness";

const roleAccent: Record<string, string> = {
  direct: "text-text-secondary",
  relay: "text-accent-primary",
  receiver: "text-status-success",
  unset: "text-text-tertiary",
};

export function GroundStationMeshCard() {
  const t = useTranslations("groundStationOverview.mesh");
  const roleInfo = useGroundStationStore((s) => s.role.info);
  const roleFetchedAt = useGroundStationStore((s) => s.role.fetchedAt);
  const health = useGroundStationStore((s) => s.mesh.health);
  const meshFetchedAt = useGroundStationStore((s) => s.mesh.fetchedAt);
  const roleFreshness = useGsSliceFreshness(roleFetchedAt);
  const meshFreshness = useGsSliceFreshness(meshFetchedAt);

  const roleKnown = roleFreshness !== "unread" && roleInfo !== null;
  const role = roleInfo?.current ?? "unset";
  // Mesh fields are a reading only once the mesh itself has been read and the
  // node returned a health block.
  const meshHealth = meshFreshness !== "unread" ? health : null;
  // The card's badge reports the least-current of the two reads it shows.
  const cardFreshness =
    roleFreshness === "unread" || meshFreshness === "unread"
      ? "unread"
      : roleFreshness === "stale" || meshFreshness === "stale"
        ? "stale"
        : "fresh";
  const dim = cardFreshness === "stale" && "opacity-60";
  const unknown = <span className="text-text-tertiary">{t("unknown")}</span>;

  return (
    <div className="rounded-lg border border-border-default bg-surface-secondary p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wide text-text-tertiary flex items-center gap-2">
          {t("title")}
          <GsFreshnessBadge freshness={cardFreshness} />
        </h3>
        {roleKnown ? (
          <span
            className={cn(
              "text-sm font-medium",
              roleAccent[role] ?? "text-text-secondary",
              dim,
            )}
          >
            {t(`role.${role}`)}
          </span>
        ) : (
          <span className="text-sm">{unknown}</span>
        )}
      </div>
      {!roleKnown ? null : roleInfo.mesh_capable ? (
        <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-1 text-xs", dim)}>
          <dt className="text-text-tertiary">{t("status")}</dt>
          <dd
            className={
              meshHealth?.up ? "text-status-success" : "text-text-secondary"
            }
          >
            {meshHealth ? (meshHealth.up ? t("up") : t("down")) : unknown}
          </dd>

          <dt className="text-text-tertiary">{t("peers")}</dt>
          <dd className="text-text-primary tabular-nums">
            {meshHealth?.peer_count ?? unknown}
          </dd>

          <dt className="text-text-tertiary">{t("partition")}</dt>
          <dd
            className={
              meshHealth?.partition ? "text-status-warning" : "text-text-secondary"
            }
          >
            {meshHealth
              ? meshHealth.partition
                ? t("partitioned")
                : t("connected")
              : unknown}
          </dd>

          {meshHealth?.mesh_id && (
            <>
              <dt className="text-text-tertiary">{t("meshId")}</dt>
              <dd className="text-text-secondary font-mono truncate">
                {meshHealth.mesh_id}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className={cn("text-xs text-text-tertiary", dim)}>{t("notCapable")}</p>
      )}
    </div>
  );
}
