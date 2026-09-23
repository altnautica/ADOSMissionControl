"use client";

/**
 * @module GroundStationUplinkCard
 * @description Compact uplink-status card for the GroundStationOverview.
 * Shows the active interface, health, fallback priority, and data-cap
 * state when present.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { GsFreshnessBadge, useGsSliceFreshness } from "./gs-slice-freshness";

const healthTone: Record<string, string> = {
  ok: "text-status-success",
  degraded: "text-status-warning",
  down: "text-status-error",
};

const dataCapTone: Record<string, string> = {
  ok: "text-text-secondary",
  warn_80: "text-status-warning",
  throttle_95: "text-status-warning",
  blocked_100: "text-status-error",
};

export function GroundStationUplinkCard() {
  const t = useTranslations("groundStationOverview.uplink");
  const uplink = useGroundStationStore((s) => s.uplink);
  // The slice's defaults (no active uplink, no health) are not a reading; until
  // the node has been read the card says so rather than reporting "None".
  const freshness = useGsSliceFreshness(uplink.fetchedAt);
  const unread = freshness === "unread";
  const unknown = <span className="text-text-tertiary">{t("status.unknown")}</span>;

  return (
    <div className="rounded-lg border border-border-default bg-bg-secondary p-3 space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-text-tertiary flex items-center gap-2">
        {t("title")}
        <GsFreshnessBadge freshness={freshness} />
      </h3>
      <dl
        className={cn(
          "grid grid-cols-2 gap-x-3 gap-y-1 text-xs",
          freshness === "stale" && "opacity-60",
        )}
      >
        <dt className="text-text-tertiary">{t("active")}</dt>
        <dd className="text-text-primary">
          {unread ? unknown : (uplink.active ?? t("none"))}
        </dd>

        <dt className="text-text-tertiary">{t("health")}</dt>
        {uplink.health === null || unread ? (
          <dd>{unknown}</dd>
        ) : (
          <dd className={healthTone[uplink.health] ?? "text-text-secondary"}>
            {t(`status.${uplink.health}`)}
          </dd>
        )}

        {uplink.priority.length > 0 && (
          <>
            <dt className="text-text-tertiary">{t("priority")}</dt>
            <dd className="text-text-secondary truncate">
              {uplink.priority.join(" → ")}
            </dd>
          </>
        )}

        {uplink.data_cap && (
          <>
            <dt className="text-text-tertiary">{t("dataCap")}</dt>
            <dd className={`${dataCapTone[uplink.data_cap.state] ?? "text-text-secondary"} tabular-nums`}>
              {uplink.data_cap.percent.toFixed(0)}% ({uplink.data_cap.used_mb}/{uplink.data_cap.cap_mb} MB)
            </dd>
          </>
        )}

        {uplink.cloud_relay && (
          <>
            <dt className="text-text-tertiary">{t("cloudRelay")}</dt>
            <dd className="flex items-center gap-1.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  uplink.cloud_relay.mqtt_connected
                    ? "bg-status-success"
                    : "bg-status-error"
                }`}
                aria-hidden
              />
              <span
                className={
                  uplink.cloud_relay.forwarding_video
                    ? "text-text-secondary"
                    : "text-status-warning"
                }
              >
                {uplink.cloud_relay.forwarding_video
                  ? t("fwdVideoTelemetry")
                  : uplink.cloud_relay.forwarding_telemetry
                    ? t("fwdTelemetryOnly")
                    : t("fwdPaused")}
              </span>
            </dd>
          </>
        )}
      </dl>

      {uplink.shareUplinkApplied === false && (
        <p
          role="alert"
          className="text-xs text-status-warning border-t border-border-default pt-2"
        >
          {t("shareUplinkNotApplied")}:{" "}
          {uplink.shareUplinkAppliedReason ?? t("shareUplinkNotAppliedDefault")}
        </p>
      )}
    </div>
  );
}
