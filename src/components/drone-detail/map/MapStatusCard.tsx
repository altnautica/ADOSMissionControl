"use client";

/**
 * @module drone-detail/map/MapStatusCard
 * @description The Map tab's status card for the world-engine `map_status`:
 * session, sweep points, area, pose health, compute placement, memory against
 * its budget, voxel size, dropped keyframes, upload progress and stream
 * state. The empty and stale states are explicit; a stale card keeps its last
 * values, marked stale.
 *
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import type { NavHealth } from "@/lib/agent/nav-types";
import { cn } from "@/lib/utils";
import {
  PLACEMENT_KEY,
  STREAM_KEY,
  UPLOAD_KEY,
  type MapStatusView,
} from "@/components/drone-detail/map/map-status-view";

interface MapStatusCardProps {
  view: MapStatusView;
  /** Pose health from the nav feed while fresh, else null. */
  poseHealth: NavHealth | null;
}

const HEALTH_TONE: Record<NavHealth, string> = {
  good: "text-status-success",
  degraded: "text-status-warning",
  lost: "text-status-error",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="font-mono text-xs tabular-nums text-text-primary text-right">{children}</dd>
    </div>
  );
}

export function MapStatusCard({ view, poseHealth }: MapStatusCardProps) {
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
            {t("stale")}
          </span>
        )}
      </header>
      {!s ? (
        <p className="text-xs text-text-secondary">{t("noData")}</p>
      ) : (
        <dl className={cn("divide-y divide-border-default", view.state === "stale" && "opacity-60")}>
          <Row label={t("session")}>{s.sessionId ?? t("noSession")}</Row>
          <Row label={t("points")}>{s.sweepPoints !== null ? s.sweepPoints.toLocaleString() : dash}</Row>
          <Row label={t("area")}>{s.areaM2 !== null ? `${s.areaM2.toFixed(1)} m²` : dash}</Row>
          <Row label={t("health")}>
            {poseHealth ? <span className={HEALTH_TONE[poseHealth]}>{tq(poseHealth)}</span> : t("noPose")}
          </Row>
          <Row label={t("placement")}>{s.placement ? t(PLACEMENT_KEY[s.placement]) : dash}</Row>
          <Row label={t("memory")}>
            {s.memoryUsedMb !== null && s.memoryBudgetMb !== null ? (
              <span className="inline-flex items-center gap-2">
                {view.memoryFraction !== null && (
                  <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-bg-tertiary" aria-hidden="true">
                    <span
                      className={cn(
                        "block h-full",
                        view.memoryFraction > 0.9 ? "bg-status-warning" : "bg-accent-primary",
                      )}
                      style={{ width: `${Math.round(view.memoryFraction * 100)}%` }}
                    />
                  </span>
                )}
                {t("memoryValue", {
                  used: Math.round(s.memoryUsedMb),
                  budget: Math.round(s.memoryBudgetMb),
                })}
              </span>
            ) : (
              dash
            )}
          </Row>
          <Row label={t("voxel")}>{s.voxelM !== null ? `${(s.voxelM * 100).toFixed(0)} cm` : dash}</Row>
          <Row label={t("keyframesDropped")}>{s.keyframesDropped ?? dash}</Row>
          {s.navPose && (
            <Row label={t("navPose")}>{t(s.navPose === "always" ? "navPoseAlways" : "navPoseCapture")}</Row>
          )}
          {s.upload && (
            <Row label={t("upload")}>{t(UPLOAD_KEY[s.upload.state], { pct: view.uploadPct ?? 0 })}</Row>
          )}
          {s.stream && (
            <Row label={t("stream")}>{t(STREAM_KEY[s.stream.state], { rate: view.streamRate ?? dash })}</Row>
          )}
        </dl>
      )}
    </section>
  );
}
