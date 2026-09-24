"use client";

/**
 * @module DroneLiveWorldTab
 * @description The during-flight Atlas "Live World" view: the drone-side monitor
 * of a world-model capture session (capture stats, the building splat, the
 * paired reconstructor, the active transport bearer) PLUS the operator capture
 * controls (Start / Pause / Resume / Stop & Reconstruct + a manual Reconstruct
 * now). Reads the live `atlas*` heartbeat off the focused-drone atlas store and
 * drives capture through `useAtlasControl`. Shown only while the drone is
 * capturing (the readiness gate on the tab), so the controls always apply to a
 * live session. Mounted behind the Atlas flag.
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Activity, Boxes, Clock, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ATLAS_VIEWERS,
  DEFAULT_ATLAS_VIEWER,
  backendOf,
  viewerHintOf,
  type AtlasViewer,
} from "@/components/atlas/viewer-types";
import { WorldModelViewport } from "@/components/atlas/WorldModelViewport";
import { AtlasCaptureControls } from "@/components/drone-detail/atlas/AtlasCaptureControls";
import { ReconstructQualitySelect } from "@/components/drone-detail/atlas/ReconstructQualitySelect";
import {
  DEFAULT_RECONSTRUCTION_STEPS,
  qualityForSteps,
} from "@/lib/atlas/reconstruction-quality";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useDroneWorldModel } from "@/hooks/use-drone-world-model";
import { useAtlasControl } from "@/hooks/use-atlas-control";
import { cmdAtlasJobsApi } from "@/lib/community-api-drones";
import { useAtlasStore } from "@/stores/atlas-store";
import { useAuthStore } from "@/stores/auth-store";
import { useAtlasLocalState } from "@/hooks/use-atlas-local-state";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import type { Doc } from "../../../convex/_generated/dataModel";

type AtlasJob = Doc<"cmd_atlasJobs">;

// The Atlas capture fields ride the drone cloud heartbeat (~seconds cadence),
// not the 10 Hz telemetry stream, so the staleness budget is heartbeat-scaled.
const STALE_MS = 15000;

function num(v: number | null): string {
  return v === null ? "—" : String(v);
}

function rate(v: number | null): string {
  return v === null ? "—" : v.toFixed(1);
}

// The agent's CaptureState vocabulary (idle/capturing/paused/finalizing/bagged),
// plus a few forward-looking states a richer producer may emit.
const STATE_TONE: Record<string, string> = {
  capturing: "text-status-success",
  active: "text-status-success",
  finalizing: "text-accent-primary",
  ready: "text-accent-primary",
  paused: "text-status-warning",
  bagged: "text-text-tertiary",
  ended: "text-text-tertiary",
  idle: "text-text-tertiary",
  error: "text-status-error",
};

const VIO_TONE: Record<string, string> = {
  good: "text-status-success",
  degraded: "text-status-warning",
  lost: "text-status-error",
};

const BEARER_LABEL_KEY: Record<string, string> = {
  "direct-lan": "capture.bearerDirectLan",
  "wfb-relay": "capture.bearerWfbRelay",
  cloud: "capture.bearerCloud",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-text-primary/[0.02] px-2 py-1.5 text-center">
      <div className="text-sm font-mono text-text-primary tabular-nums">
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border-default rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">{title}</span>
      </div>
      {children}
    </div>
  );
}

export function DroneLiveWorldTab({ droneId }: { droneId?: string }) {
  const t = useTranslations("atlas");
  const live = useAtlasStore((s) => s.live);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // The shared 1 Hz clock re-derives heartbeat age and staleness.
  useClockTick();
  const now = useClockStore((s) => s.now);
  // Local-first: poll this drone's agent for its Atlas state when LAN-paired
  // (signed out), feeding the same store the cloud heartbeat path feeds.
  useAtlasLocalState(droneId);
  // Capture control (readiness poll + lifecycle callbacks).
  const control = useAtlasControl(droneId);

  // "{n}s ago" / "{n}m ago" from an epoch-ms timestamp, or null when absent.
  const ago = useMemo(
    () =>
      (tsMs: number | null): string | null => {
        if (tsMs === null) return null;
        const s = Math.max(0, Math.round((now - tsMs) / 1000));
        return s < 60
          ? t("capture.agoSeconds", { s })
          : t("capture.agoMinutes", { m: Math.round(s / 60) });
      },
    [now, t],
  );

  // Reconstructions ride the SAME source as the post-flight World Model tab.
  // Keyed by the BARE device id — `cmd_atlasJobs.listForDevice` matches rows by
  // the agent's bare deviceId, not the `node:<deviceId>` selection id.
  const jobs = useConvexSkipQuery(cmdAtlasJobsApi.listForDevice, {
    args: { deviceId: control.deviceId ?? "" },
    enabled: Boolean(control.deviceId),
  }) as AtlasJob[] | undefined;

  const [override, setOverride] = useState<{
    sessionKey: string;
    viewer: AtlasViewer;
  } | null>(null);

  // CLOUD FALLBACK: the newest completed reconstruction for the ACTIVE session.
  const cloud = useMemo<{
    artifactUrl: string | null;
    viewerHint: AtlasViewer | null;
    backend: string | null;
  }>(() => {
    const list = jobs ?? [];
    const scoped = live.sessionId
      ? list.filter((j) => j.sessionId === live.sessionId)
      : list;
    const done = scoped.find(
      (j) => j.status === "done" && Boolean(j.outputUrl),
    );
    return {
      artifactUrl: done?.outputUrl ?? null,
      viewerHint: done ? viewerHintOf(done.metadata) : null,
      backend: done ? backendOf(done.metadata) : null,
    };
  }, [jobs, live.sessionId]);

  // LOCAL-FIRST primary: the world model off the paired compute node, correlated
  // by the active session id (local-first). Also gives us the compute client for the
  // manual "Reconstruct now" submit (no second poll loop).
  const local = useDroneWorldModel({
    sessionId: live.sessionId,
    computeNodeId: live.computeNodeId,
  });

  const commandable = control.live || control.demo;

  // "Reconstruct now" wiring: submit a reconstruct job for the active session on
  // the paired compute node. Available only with a reachable compute client + a
  // live session, and not in demo (no real node).
  const reconstructAvailable =
    Boolean(local.computeClient) && Boolean(live.sessionId) && !control.demo;
  const reconstructDisabledKey = control.demo
    ? "capture.reconstructDisabledDemo"
    : !live.sessionId
      ? "capture.reconstructDisabledNoSession"
      : "capture.reconstructDisabledNoNode";
  const reconstructSubmit = async (): Promise<boolean> => {
    const client = local.computeClient;
    if (!client || !live.sessionId) return false;
    // Carry the capturing drone's device_id so the compute node's job sidecar can
    // attribute the reconstruct and forward it to cloud (cmd_atlasJobs) — a
    // reconstruct job with no device_id is skipped by that producer, so a manual
    // "Reconstruct now" would otherwise never sync like an auto-bag does.
    const params: Record<string, unknown> = { session_id: live.sessionId };
    if (control.deviceId) params.device_id = control.deviceId;
    // The operator's chosen detail level (persisted on the drone's atlas config)
    // → the Brush training params for this reconstruct job. The gaussian-count
    // cap + SH degree are what keep training fast (a bounded budget), so carry
    // them alongside the step count.
    const steps =
      control.readiness?.reconstructSteps ?? DEFAULT_RECONSTRUCTION_STEPS;
    const quality = qualityForSteps(steps);
    params.steps = steps;
    params.max_splats = quality.maxSplats;
    params.sh_degree = quality.shDegree;
    const res = await client.submitJob({ kind: "reconstruct", params });
    return res !== null;
  };

  const sessionKey = live.sessionId ?? "";
  const useLocal = local.status === "ready" || local.status === "building";
  const artifactUrl = useLocal ? local.artifactUrl : cloud.artifactUrl;
  const viewerHint = useLocal ? local.viewerHint : cloud.viewerHint;
  // The honest reconstruction backend for the World Model badge (no fabricated reading).
  const backend = useLocal ? local.backend : cloud.backend;
  // A paired-but-unreachable compute node must NOT look identical to an
  // actively-building one. Surface the stalled reconstructor distinctly, keep
  // the "no node" guidance when none is paired, and reserve the "building"
  // message for a reachable node (or the cloud fallback) genuinely in progress.
  const worldEmptyMessage =
    local.hasComputeNode && local.status === "unreachable"
      ? t("capture.reconstructorUnreachable")
      : !isAuthenticated && !local.hasComputeNode
        ? t("worldModelNoNode")
        : t("liveWorldBuilding");

  const viewer =
    override && override.sessionKey === sessionKey
      ? override.viewer
      : viewerHint ?? DEFAULT_ATLAS_VIEWER;

  // Never render a frozen heartbeat as live. When the heartbeat has
  // gone quiet past the budget, badge it stale and dim the rates.
  const hasLive = live.state !== null;
  const heartbeatAge = live.updatedAt === null ? null : now - live.updatedAt;
  const isStale = heartbeatAge === null || heartbeatAge > STALE_MS;
  const stateLabel = live.state ?? control.readiness?.state ?? "idle";
  const stateTone = isStale
    ? "text-status-warning"
    : STATE_TONE[stateLabel] ?? "text-text-secondary";
  const kfAgo = ago(live.lastKfAt);
  const sessionId = live.sessionId ?? control.readiness?.sessionId ?? null;

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="p-4 space-y-4">
        {/* Session header */}
        <div className="flex items-center justify-between border border-border-default rounded-lg p-3">
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-text-tertiary" />
            <span className="text-sm font-medium text-text-primary">
              {t("capture.liveWorldTitle")}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded bg-text-primary/[0.04]",
                stateTone,
              )}
            >
              {isStale && hasLive ? t("stale") : stateLabel}
            </span>
            {isStale && hasLive && (
              <span className="flex items-center gap-1 text-[10px] text-status-warning">
                <Clock className="w-3 h-3" />
                {ago(live.updatedAt) ?? t("capture.noHeartbeat")}
              </span>
            )}
          </div>
          <span
            className="text-[10px] font-mono text-text-tertiary truncate max-w-[40%]"
            title={sessionId ?? undefined}
          >
            {sessionId ?? t("capture.noSession")}
          </span>
        </div>

        {/* Capture controls */}
        <div className="border border-border-default rounded-lg p-3 space-y-2">
          <span className="text-xs font-medium text-text-secondary">
            {t("capture.captureControlsTitle")}
          </span>
          <ReconstructQualitySelect control={control} />
          <AtlasCaptureControls
            control={control}
            canStart={commandable}
            startBlockedKey={null}
            blockedKey={commandable ? null : "capture.notLocalReason"}
            reconstruct={{
              available: reconstructAvailable,
              disabledKey: reconstructAvailable ? null : reconstructDisabledKey,
              submit: reconstructSubmit,
            }}
          />
        </div>

        {hasLive ? (
          <div
            className={cn(
              "grid grid-cols-1 xl:grid-cols-2 gap-4 transition-opacity",
              isStale && "opacity-50",
            )}
          >
            <Card title={t("capture.captureSection")} icon={Activity}>
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label={t("capture.statKeyframes")}
                  value={num(live.keyframesIngested)}
                />
                <Stat
                  label={t("capture.statIngestHz")}
                  value={rate(live.ingestRateHz)}
                />
                <Stat
                  label={t("capture.statCameras")}
                  value={num(live.cameraCount)}
                />
              </div>
              {live.vioHealth !== null && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-tertiary">
                    {t("capture.vioTracking")}
                  </span>
                  <span
                    className={cn(
                      "font-medium",
                      VIO_TONE[live.vioHealth] ?? "text-text-secondary",
                    )}
                  >
                    {live.vioHealth}
                  </span>
                </div>
              )}
            </Card>

            <Card title={t("capture.streamSection")} icon={Radio}>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-text-tertiary">
                    {t("capture.computeNode")}
                  </span>
                  <span
                    className="font-mono text-text-secondary truncate max-w-[60%]"
                    title={live.computeNodeId ?? undefined}
                  >
                    {live.computeNodeId ?? "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-tertiary">
                    {t("capture.bearer")}
                  </span>
                  <span className="font-mono text-text-secondary">
                    {live.bearer
                      ? BEARER_LABEL_KEY[live.bearer]
                        ? t(BEARER_LABEL_KEY[live.bearer])
                        : live.bearer
                      : "—"}
                  </span>
                </div>
                {live.bearer === "wfb-relay" && (
                  <div className="flex items-center justify-between">
                    <span className="text-text-tertiary">
                      {t("capture.relayDecimation")}
                    </span>
                    <span className="font-mono text-text-secondary tabular-nums">
                      {num(live.relayDecimation)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-text-tertiary">
                    {t("capture.lastKeyframe")}
                  </span>
                  <span className="font-mono text-text-secondary tabular-nums">
                    {kfAgo ?? "—"}
                  </span>
                </div>
              </div>
            </Card>
          </div>
        ) : (
          <div className="border border-border-default rounded-lg p-6 text-center">
            <Boxes className="w-5 h-5 text-text-tertiary mx-auto mb-2 animate-pulse" />
            <p className="text-[11px] text-text-tertiary">
              {t("capture.awaitingTelemetry")}
            </p>
          </div>
        )}

        {/* Live world model: the newest completed reconstruction for the active
            session, refreshing in place as periodic reconstruct cycles land. */}
        <div className="border border-border-default rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
            <Boxes className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-xs font-medium text-text-secondary">
              {t("capture.worldModelSection")}
            </span>
            {artifactUrl && (
              <div
                className="flex items-center gap-1 ml-auto"
                role="group"
                aria-label={t("viewerGroupLabel")}
              >
                {ATLAS_VIEWERS.map((vw) => (
                  <button
                    key={vw.id}
                    type="button"
                    aria-pressed={viewer === vw.id}
                    onClick={() => setOverride({ sessionKey, viewer: vw.id })}
                    className={cn(
                      "text-[11px] px-2 py-1 rounded transition-colors",
                      viewer === vw.id
                        ? "bg-accent-primary/20 text-accent-primary"
                        : "text-text-tertiary hover:text-text-secondary",
                    )}
                  >
                    {vw.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative h-[420px]">
            {artifactUrl ? (
              <WorldModelViewport
                viewer={viewer}
                artifactUrl={artifactUrl}
                backend={backend}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="text-center">
                  <Boxes className="w-5 h-5 text-text-tertiary mx-auto mb-2 animate-pulse" />
                  <p className="text-[11px] text-text-tertiary max-w-xs">
                    {worldEmptyMessage}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
