"use client";

/**
 * @module DroneWorldModelTab
 * @description The Atlas "World Model" drone tab. Two states:
 *
 *  - **A reconstruction exists** → the viewer: a session selector + a viewer
 *    switcher (Rerun / Splat / Cloud / …) over the world a captured session
 *    reconstructed. Sourced LOCAL-FIRST (Rule 39) from the paired compute /
 *    workstation node (`useDroneWorldModel`), correlated by `session_id`; the
 *    Convex `cmd_atlasJobs` path is the cloud fallback.
 *  - **No reconstruction yet** → a self-explaining setup surface: the live video
 *    stream + a how-it-works explainer + a requirements checklist (cameras /
 *    compute node reachable / capture service) + Enable + Start capture controls
 *    (disabled with the reason until requirements pass).
 *
 * The "per-drone enable" is a capture action (`PUT /api/atlas/config` over the
 * LAN), NOT a tab-visibility gate — the tab is always shown while the Atlas
 * feature flag is on. Mounts `useAtlasControl` so readiness is polled whenever
 * this tab is open; that readiness is what makes the Live World tab appear while
 * capturing.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Boxes, Video, Camera, Cpu, Eye } from "lucide-react";
import {
  DEFAULT_ATLAS_VIEWER,
  backendOf,
  viewerHintOf,
  type AtlasViewer,
} from "@/components/atlas/viewer-types";
import { WorldModelViewport } from "@/components/atlas/WorldModelViewport";
import { WorldGenerationCard } from "@/components/atlas/WorldGenerationCard";
import { ViewerSwitcher } from "@/components/atlas/ViewerSwitcher";
import { MiniVideoView } from "@/components/command/shared/MiniVideoView";
import { AtlasRequirementsChecklist } from "@/components/drone-detail/atlas/AtlasRequirementsChecklist";
import { AtlasCaptureControls } from "@/components/drone-detail/atlas/AtlasCaptureControls";
import { ReconstructQualitySelect } from "@/components/drone-detail/atlas/ReconstructQualitySelect";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useDroneWorldModel } from "@/hooks/use-drone-world-model";
import { useAtlasControl } from "@/hooks/use-atlas-control";
import { computeCaptureGate } from "@/lib/atlas/capture-requirements";
import { useAuthStore } from "@/stores/auth-store";
import { cmdAtlasJobsApi } from "@/lib/community-api-drones";
import type { Doc } from "../../../convex/_generated/dataModel";

type AtlasJob = Doc<"cmd_atlasJobs">;

/** A short, human-ish label for a cloud-fallback session. */
function cloudSessionLabel(job: AtlasJob): string {
  const id = job.sessionId ?? job._id;
  return `${job.kind} · ${id.slice(0, 8)} · ${job.status}`;
}

/** i18n key for a pose source. */
function poseSourceKey(source: string): string {
  switch (source) {
    case "offloaded_slam":
      return "capture.poseOffloadedSlam";
    case "hybrid":
      return "capture.poseHybrid";
    default:
      return "capture.poseLocalVio";
  }
}

/** The capture-quality profiles the agent contract advertises today. Kept as a
 * local set (the agent exposes no discovery endpoint yet); an unknown value the
 * agent reports is preserved as its own option so the picker never drops it.
 * These MUST match the agent's strict capture-profile enum (orbit / lawnmower /
 * freeform / inspection) — any other value is rejected by the agent config. */
const CAPTURE_PROFILES = [
  "orbit",
  "lawnmower",
  "freeform",
  "inspection",
] as const;

const CAPTURE_PROFILE_LABEL_KEY: Record<string, string> = {
  orbit: "capture.profileOrbit",
  lawnmower: "capture.profileLawnmower",
  freeform: "capture.profileFreeform",
  inspection: "capture.profileInspection",
};

/** Build the capture-profile options, always including the current value even
 * when the agent advertises a profile outside the known set. */
function captureProfileOptions(
  current: string,
  t: (key: string) => string,
): SelectOption[] {
  const opts: SelectOption[] = CAPTURE_PROFILES.map((p) => ({
    value: p,
    label: t(CAPTURE_PROFILE_LABEL_KEY[p]),
  }));
  if (current && !CAPTURE_PROFILES.includes(current as (typeof CAPTURE_PROFILES)[number])) {
    opts.unshift({ value: current, label: current });
  }
  return opts;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-tertiary">{label}</span>
      <span className="font-mono text-text-secondary tabular-nums">{value}</span>
    </div>
  );
}

function HowStep({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Camera;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-accent-primary shrink-0 mt-0.5" />
      <div>
        <div className="text-[11px] font-medium text-text-primary">{title}</div>
        <div className="text-[10px] text-text-tertiary">{body}</div>
      </div>
    </div>
  );
}

export function DroneWorldModelTab({ droneId }: { droneId?: string }) {
  const t = useTranslations("atlas");
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const control = useAtlasControl(droneId);
  const readiness = control.readiness;

  // Selection is tracked per source (a local sessionId vs a cloud job id); only
  // one source renders at a time.
  const [localSession, setLocalSession] = useState<string>("");
  const [cloudJobId, setCloudJobId] = useState<string>("");
  const [override, setOverride] = useState<{
    key: string;
    viewer: AtlasViewer;
  } | null>(null);

  // Local-first primary: the artifact off the paired compute node.
  const local = useDroneWorldModel({
    sessionId: localSession || null,
    computeNodeId: null,
  });

  // Cloud fallback: the reactive cmd_atlasJobs list (resolved by capturing
  // device). Skips in demo / no-convex / no-deviceId. Keyed by the BARE device
  // id — `cmd_atlasJobs.listForDevice` matches `cmd_drones`/`cmd_atlasJobs` rows
  // by the agent's bare deviceId, not the `node:<deviceId>` selection id.
  const cloudJobs = useConvexSkipQuery(cmdAtlasJobsApi.listForDevice, {
    args: { deviceId: control.deviceId ?? "" },
    enabled: Boolean(control.deviceId),
  }) as AtlasJob[] | undefined;

  const useLocal = local.status === "ready" || local.status === "building";

  // Resolve a unified view model from the active source.
  let artifactUrl: string | null;
  let hint: AtlasViewer | null;
  // The honest reconstruction backend for the badge (Rule 44). The cloud path
  // reads it defensively off the opaque job metadata (null until the
  // compute→Convex producer forwards it).
  let backend: string | null;
  let sessionOptions: SelectOption[];
  let selectedValue: string;
  let onSelect: (v: string) => void;

  if (useLocal) {
    artifactUrl = local.artifactUrl;
    hint = local.viewerHint;
    backend = local.backend;
    sessionOptions = local.sessions.map((s) => ({
      value: s.sessionId,
      label: s.sessionId.slice(0, 12),
    }));
    selectedValue =
      local.sessions.find((s) => s.sessionId === localSession)?.sessionId ??
      local.sessions[0]?.sessionId ??
      "";
    onSelect = setLocalSession;
  } else {
    const list = cloudJobs ?? [];
    const latestDone = list.find(
      (j) => j.status === "done" && Boolean(j.outputUrl),
    );
    const selectedJob =
      list.find((j) => j._id === cloudJobId) ?? latestDone ?? null;
    artifactUrl =
      selectedJob && selectedJob.status === "done"
        ? selectedJob.outputUrl ?? null
        : null;
    hint = selectedJob ? viewerHintOf(selectedJob.metadata) : null;
    backend = selectedJob ? backendOf(selectedJob.metadata) : null;
    sessionOptions = list.map((j) => ({
      value: j._id,
      label: cloudSessionLabel(j),
    }));
    selectedValue = selectedJob?._id ?? "";
    onSelect = setCloudJobId;
  }

  const viewer =
    override && override.key === selectedValue
      ? override.viewer
      : hint ?? DEFAULT_ATLAS_VIEWER;

  // ── Viewer mode: a reconstruction exists ────────────────────────────────────
  if (artifactUrl) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 p-3 border-b border-border-default">
          <Boxes className="w-4 h-4 text-text-tertiary" />
          <span className="text-sm font-medium text-text-primary mr-2">
            {t("worldModelHeading")}
          </span>
          {sessionOptions.length > 0 && (
            <Select
              options={sessionOptions}
              value={selectedValue}
              onChange={onSelect}
              placeholder={t("worldModelSelectSession")}
              className="w-64"
            />
          )}
          <ViewerSwitcher
            viewer={viewer}
            onSelect={(v) => setOverride({ key: selectedValue, viewer: v })}
            ariaLabel={t("viewerGroupLabel")}
          />
        </div>
        <div className="flex-1 flex min-h-[320px]">
          <div className="flex-1 relative">
            <WorldModelViewport
              viewer={viewer}
              artifactUrl={artifactUrl}
              backend={backend}
            />
          </div>
          {/* The shared-data facts beside the picture: which generation is on
              screen and what it actually contains. The viewer shows an
              artifact; only the descriptors say whether a planning input
              exists for it. */}
          <aside className="w-72 shrink-0 overflow-auto border-l border-border-default p-2">
            <WorldGenerationCard
              droneDeviceId={control.deviceId}
              computeNodeDeviceId={local.computeNodeDeviceId}
            />
          </aside>
        </div>
      </div>
    );
  }

  // ── Setup mode: no reconstruction yet ───────────────────────────────────────
  const commandable = control.live || control.demo;
  const gate = computeCaptureGate({
    readiness,
    computePaired: local.hasComputeNode,
    computeReachable: local.status === "ready" || local.status === "building",
    demo: control.demo,
  });
  const enabled = readiness?.enabled === true;
  const capturing = readiness?.capturing === true;
  const captureProfile = readiness?.captureProfile || "freeform";
  const profileOptions = captureProfileOptions(captureProfile, t);

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="w-4 h-4 text-accent-primary" />
            <h2 className="text-sm font-semibold text-text-primary">
              {t("capture.setupTitle")}
            </h2>
          </div>
          <p className="mt-1 text-[11px] text-text-tertiary max-w-2xl">
            {t("capture.setupIntro")}
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Left: live stream + how-it-works */}
          <div className="space-y-3">
            <div className="border border-border-default rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-text-tertiary" />
                <span className="text-xs font-medium text-text-secondary">
                  {t("capture.liveStreamTitle")}
                </span>
              </div>
              <MiniVideoView />
            </div>

            <div className="border border-border-default rounded-lg p-3 space-y-2.5">
              <span className="text-xs font-medium text-text-secondary">
                {t("capture.howItWorksTitle")}
              </span>
              <HowStep
                icon={Camera}
                title={t("capture.howStep1Title")}
                body={t("capture.howStep1Body")}
              />
              <HowStep
                icon={Cpu}
                title={t("capture.howStep2Title")}
                body={t("capture.howStep2Body")}
              />
              <HowStep
                icon={Eye}
                title={t("capture.howStep3Title")}
                body={t("capture.howStep3Body")}
              />
            </div>
          </div>

          {/* Right: requirements + controls */}
          <div className="space-y-3">
            <WorldGenerationCard
              droneDeviceId={control.deviceId}
              computeNodeDeviceId={local.computeNodeDeviceId}
            />
            <div className="border border-border-default rounded-lg p-3">
              <AtlasRequirementsChecklist requirements={gate.requirements} />
            </div>

            <div className="border border-border-default rounded-lg p-3 space-y-3">
              <span className="text-xs font-medium text-text-secondary">
                {t("capture.captureControlsTitle")}
              </span>

              {readiness && (
                <div className="space-y-1.5">
                  <InfoRow
                    label={t("capture.camerasLabel")}
                    value={String(readiness.camerasConfigured)}
                  />
                  <InfoRow
                    label={t("capture.poseSourceLabel")}
                    value={t(poseSourceKey(readiness.poseSource))}
                  />
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-text-tertiary">
                      {t("capture.profileLabel")}
                    </span>
                    <div className="w-40">
                      <Select
                        options={profileOptions}
                        value={captureProfile}
                        onChange={(v) => void control.setCaptureProfile(v)}
                        disabled={!commandable || control.busy}
                      />
                    </div>
                  </div>
                  <ReconstructQualitySelect control={control} />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={enabled ? "secondary" : "primary"}
                  loading={control.busy}
                  disabled={!commandable || control.busy}
                  title={!commandable ? t("capture.notLocalReason") : undefined}
                  onClick={enabled ? control.disable : control.enable}
                >
                  {enabled
                    ? t("capture.disableCapture")
                    : t("capture.enableCapture")}
                </Button>
              </div>

              <AtlasCaptureControls
                control={control}
                canStart={gate.canStart}
                startBlockedKey={gate.startBlockedKey}
                blockedKey={commandable ? null : "capture.notLocalReason"}
              />

              {capturing && (
                <p className="text-[10px] text-accent-primary">
                  {t("capture.capturingHint")}
                </p>
              )}

              {!commandable && !isAuthenticated && !local.hasComputeNode && (
                <p className="text-[10px] text-text-tertiary">
                  {t("worldModelNoNode")}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
