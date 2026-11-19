"use client";

/**
 * @module drone-detail/map/MapStatusCard
 * @description The Map tab's status card for Navigation's `map_status`:
 * sweep points, area, pose health, compute placement, the compute node the
 * live map streams from (streamed placement), memory against its budget,
 * voxel size, the pose provider and the FC IMU feed. The empty and stale
 * states are explicit; a stale card keeps its last values, marked stale.
 *
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import type { NavHealth } from "@/lib/hud/nav-types";
import { cn } from "@/lib/utils";
import { specString } from "@/lib/cockpit/spec-strings";
import {
  IMU_FEED_KEY,
  PLACEMENT_KEY,
  PROVIDER_KEY,
  type MapStatusView,
  type MapTone,
} from "@/components/drone-detail/map/map-status-view";
import type { WorldStreamState } from "@/lib/api/reconstruct/world-stream";

/** The compute node's live stream, while the drone has one. */
export interface MapStreamSource {
  /** The node's name, or its device id. */
  node: string;
  state: WorldStreamState;
}

interface MapStatusCardProps {
  view: MapStatusView;
  /** Pose health from the nav feed while fresh, else null. */
  poseHealth: NavHealth | null;
  stream?: MapStreamSource | null;
}

const STREAM_TONE: Record<WorldStreamState, string> = {
  live: "text-status-success",
  connecting: "text-status-warning",
  unreachable: "text-status-warning",
};

const STREAM_KEY = {
  live: "streamLive",
  connecting: "streamConnecting",
  unreachable: "streamUnreachable",
} as const satisfies Record<WorldStreamState, string>;

const HEALTH_TONE: Record<NavHealth, string> = {
  good: "text-status-success",
  degraded: "text-status-warning",
  lost: "text-status-error",
};

const TONE: Record<MapTone, string | undefined> = {
  ok: undefined,
  warn: "text-status-warning",
  crit: "text-status-error",
};

const BAR_TONE: Record<MapTone, string> = {
  ok: "bg-accent-primary",
  warn: "bg-status-warning",
  crit: "bg-status-error",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="font-mono text-xs tabular-nums text-text-primary text-right">{children}</dd>
    </div>
  );
}

export function MapStatusCard({ view, poseHealth, stream = null }: MapStatusCardProps) {
  const t = useTranslations("hud.mapTab");
  const tq = useTranslations("hud.nav.q");
  const s = view.status;
  const dash = "—";

  return (
    <section
      className="rounded border border-border-default bg-bg-secondary p-3"
      data-state={view.state}
      aria-label={t("status")}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-text-primary">{t("status")}</h3>
        {view.state === "stale" && (
          <span className="text-xs text-status-warning" role="status">
            {specString("map.panel.stale", { s: view.ageS ?? 0 })}
          </span>
        )}
      </header>
      {!s ? (
        <p className="text-xs text-text-secondary">{t("noData")}</p>
      ) : (
        <dl className={cn("divide-y divide-border-default", view.state === "stale" && "opacity-60")}>
          <Row label={specString("map.status.sweep_points")}>{s.sweepPoints !== null ? s.sweepPoints.toLocaleString() : dash}</Row>
          <Row label={specString("map.status.area")}>{s.areaM2 !== null ? `${s.areaM2.toFixed(1)} m²` : dash}</Row>
          <Row label={t("health")}>
            {poseHealth ? <span className={HEALTH_TONE[poseHealth]}>{tq(poseHealth)}</span> : t("noPose")}
          </Row>
          <Row label={specString("map.status.placement")}>{s.placement ? specString(PLACEMENT_KEY[s.placement]) : dash}</Row>
          {stream && (
            <Row label={t("streamSource")}>
              <span className={STREAM_TONE[stream.state]} data-stream-state={stream.state}>
                {t(STREAM_KEY[stream.state], { node: stream.node })}
              </span>
            </Row>
          )}
          <Row label={specString("map.status.memory")}>
            {s.memoryUsedMb !== null && s.memoryBudgetMb !== null ? (
              <span className="inline-flex items-center gap-2">
                {view.memoryFraction !== null && (
                  <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-bg-tertiary" aria-hidden="true">
                    <span
                      className={cn(
                        "block h-full",
                        BAR_TONE[view.memoryTone],
                      )}
                      style={{ width: `${Math.round(view.memoryFraction * 100)}%` }}
                    />
                  </span>
                )}
                <span className={TONE[view.memoryTone]} data-tone={view.memoryTone}>
                  {t("memoryValue", {
                    used: Math.round(s.memoryUsedMb),
                    budget: Math.round(s.memoryBudgetMb),
                  })}
                </span>
              </span>
            ) : (
              dash
            )}
          </Row>
          <Row label={specString("map.status.voxel_size")}>{s.voxelM !== null ? `${(s.voxelM * 100).toFixed(0)} cm` : dash}</Row>
          <Row label={specString("map.status.pose_provider")}>
            {s.poseProvider ? specString(PROVIDER_KEY[s.poseProvider]) : dash}
          </Row>
          {s.imuFeed && (
            <Row label={specString("map.status.imu_feed")}>
              <span className={TONE[view.imuTone]} data-tone={view.imuTone}>
                {specString(IMU_FEED_KEY[s.imuFeed.state])}
                {s.imuFeed.rateHz !== null ? ` · ${Math.round(s.imuFeed.rateHz)} Hz` : ""}
              </span>
            </Row>
          )}
        </dl>
      )}
    </section>
  );
}
