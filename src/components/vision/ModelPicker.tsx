"use client";

/**
 * @module vision/ModelPicker
 * @description Board-filtered vision model picker. One component, two modes:
 *   - `full` — the management surface in the Vision tab: a labelled section
 *     with cache usage, a refresh control, and an Upload button.
 *   - `compact` — the inline widget the plugin parameter renderer drops in for
 *     a `model` / `model_upload` parameter bound to `engine.detector`.
 *
 * It merges the agent's registry + installed + custom models into one list
 * (deduped, board-tagged via the pure `filterModelsForBoard`), shows which one
 * the engine has active, and lets the operator:
 *   - Download a not-yet-installed registry model, polling its progress.
 *   - Set any installed model as the engine's active detector. Because the
 *     detector is engine-wide (every vision consumer shares it), the picker
 *     says so.
 *   - Upload a custom model file (the ModelUploadDialog).
 *
 * Setting the active detector is engine-wide, so the write routes through the
 * `engine.detector` LAN seam (`setEngineDetector`) keyed by the drone. The
 * picker takes a `droneId` so the right agent is reached (local-first).
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Cpu,
  Crosshair,
} from "lucide-react";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { Badge } from "@/components/ui/badge";
import { cn, isDemoMode } from "@/lib/utils";
import {
  resolveVisionClient,
} from "@/lib/vision/resolve-vision-client";
import {
  filterModelsForBoard,
  type FilteredModel,
  type ModelFitReason,
} from "@/lib/vision/model-filter";
import type {
  VisionClient,
  VisionModelsResponse,
} from "@/lib/agent/vision-client";
import {
  setEngineDetector,
  uploadEngineModel,
} from "@/lib/skills/vision-detector-writer";
import { ModelUploadDialog } from "./ModelUploadDialog";

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATES = new Set(["complete", "error", "idle"]);

interface DownloadState {
  state: string;
  percent: number;
}

type PickerMode = "full" | "compact";

interface ModelPickerProps {
  /** Drone whose engine detector this picker manages (LAN routing). */
  droneId: string;
  /** Render mode. `full` is the Vision tab surface; `compact` is the inline
   * parameter widget. Defaults to `full`. */
  mode?: PickerMode;
  /** Fired after the active detector changes (compact widgets sync up). */
  onActiveChange?: (modelId: string) => void;
  /** Suppress the compact mode's own "Detector" header text (the upload +
   * refresh controls stay). Set when a parent (e.g. ParameterControl) already
   * renders the parameter's label, so the two don't double up. Ignored in
   * `full` mode, which has no such parent label. */
  hideHeaderLabel?: boolean;
}

/** Map a fit reason to a short human badge label. */
function fitLabel(reason: ModelFitReason): string {
  switch (reason) {
    case "needs_npu":
      return "Needs NPU";
    case "runtime_mismatch":
      return "Runtime mismatch";
    case "insufficient_tops":
      return "Low TOPS";
    case "board_mismatch":
      return "Other board";
    default:
      return "";
  }
}

export function ModelPicker({
  droneId,
  mode = "full",
  onActiveChange,
  hideHeaderLabel = false,
}: ModelPickerProps) {
  const t = useTranslations("vision");
  const { toast } = useToast();
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  // Reads (the model LIST) resolve against the single ACTIVE agent connection,
  // while writes (set-active / upload) resolve the LAN agent by `droneId` (see
  // `vision-detector-writer`). These coincide because selection drives the
  // active connection to the selected drone — this picker is only ever rendered
  // for the drone whose detail panel is open. INVARIANT: this picker must be
  // rendered only for the active connection's drone; rendering it for some
  // OTHER droneId (a non-selected drone, a future multi-panel view) would read
  // the active drone's models while writing the prop drone's detector. If a
  // multi-drone surface is added, resolve the read client by `droneId` too.
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  // Board facts: NPU runtime + TOPS from the capabilities store; the board
  // id / name / SoC / arch from the system store. Both feed the pure filter.
  const npuRuntime = useAgentCapabilitiesStore((s) => s.compute.npu_runtime);
  const npuTops = useAgentCapabilitiesStore((s) => s.compute.npu_tops);
  const boardId = useAgentSystemStore((s) => s.status?.board.model);
  const boardName = useAgentSystemStore((s) => s.status?.board.name);
  const boardSoc = useAgentSystemStore((s) => s.status?.board.soc);
  const boardArch = useAgentSystemStore((s) => s.status?.board.arch);

  const [data, setData] = useState<VisionModelsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [settingActive, setSettingActive] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const client: VisionClient | null = useMemo(
    () => resolveVisionClient(agentUrl, apiKey),
    [agentUrl, apiKey],
  );

  const refresh = useCallback(async () => {
    if (!client) {
      setError(t("noAgent"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listModels();
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("listFailed"));
    } finally {
      setLoading(false);
    }
  }, [client, t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Tear down in-flight pollers on unmount.
  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      for (const id of Object.values(timers)) clearInterval(id);
    };
  }, []);

  const models = useMemo<FilteredModel[]>(() => {
    if (!data) return [];
    return filterModelsForBoard(data, {
      soc: boardSoc,
      boardId,
      boardName,
      arch: boardArch,
      npuRuntime,
      npuTops,
    });
  }, [data, boardSoc, boardId, boardName, boardArch, npuRuntime, npuTops]);

  const startDownload = useCallback(
    async (modelId: string) => {
      if (!client) {
        toast(t("noAgent"), "warning");
        return;
      }
      setDownloads((d) => ({
        ...d,
        [modelId]: { state: "downloading", percent: 0 },
      }));
      try {
        const result = await client.download(modelId);
        if (result.status === "error") {
          setDownloads((d) => ({
            ...d,
            [modelId]: { state: "error", percent: 0 },
          }));
          toast(result.message || t("downloadFailed"), "error");
          return;
        }
      } catch (err) {
        setDownloads((d) => ({
          ...d,
          [modelId]: { state: "error", percent: 0 },
        }));
        toast(err instanceof Error ? err.message : t("downloadFailed"), "error");
        return;
      }

      if (pollTimers.current[modelId]) {
        clearInterval(pollTimers.current[modelId]);
      }
      pollTimers.current[modelId] = setInterval(async () => {
        const c = resolveVisionClient(agentUrl, apiKey);
        if (!c) return;
        try {
          const status = await c.modelStatus(modelId);
          const dl = status.download;
          const state = status.installed
            ? "complete"
            : (dl?.state ?? "downloading");
          setDownloads((d) => ({
            ...d,
            [modelId]: { state, percent: dl?.percent ?? 0 },
          }));
          if (status.installed || TERMINAL_STATES.has(state)) {
            clearInterval(pollTimers.current[modelId]);
            delete pollTimers.current[modelId];
            if (status.installed || state === "complete") {
              toast(t("downloadComplete", { id: modelId }), "success");
              refresh();
            }
          }
        } catch {
          // Transient poll error — keep polling.
        }
      }, POLL_INTERVAL_MS);
    },
    [client, agentUrl, apiKey, refresh, t, toast],
  );

  const setActive = useCallback(
    async (modelId: string) => {
      // An engine-wide detector swap restarts the vision service: every
      // vision consumer (Follow-Me, obstacle, plugins) loses detections for
      // the restart. Refused while armed.
      if (isHardBlocked) {
        toast(hardBlockMessage, "warning");
        return;
      }
      setSettingActive(modelId);
      try {
        if (isDemoMode()) {
          // Demo path: the mock client mutates its own active state.
          if (client) {
            const res = await client.setActiveDetector(modelId);
            if (res.status !== "ok") throw new Error(res.message || t("setActiveFailed"));
          }
        } else {
          const ok = await setEngineDetector({ droneId, modelId });
          if (!ok) {
            toast(t("setActiveNoAgent"), "warning");
            setSettingActive(null);
            return;
          }
        }
        toast(t("setActiveDone", { id: modelId }), "success");
        onActiveChange?.(modelId);
        // Optimistically reflect the new active model, then reconcile.
        setData((d) => (d ? { ...d, active: modelId } : d));
        refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : t("setActiveFailed"), "error");
      } finally {
        setSettingActive(null);
      }
    },
    [client, droneId, hardBlockMessage, isHardBlocked, onActiveChange, refresh, t, toast],
  );

  const handleUpload = useCallback(
    async (file: File, meta: Parameters<VisionClient["uploadModel"]>[1]) => {
      if (isDemoMode() && client) {
        return client.uploadModel(file, meta);
      }
      const res = await uploadEngineModel({ droneId, file, meta });
      if (res === null) {
        return {
          status: "error" as const,
          message: t("setActiveNoAgent"),
        };
      }
      return {
        status: "ok" as const,
        message: t("uploadDone"),
        modelId: res.modelId ?? undefined,
        verified: res.verified,
      };
    },
    [client, droneId, t],
  );

  const rows = (
    <ul className={cn("flex flex-col", mode === "compact" ? "gap-1.5" : "gap-2")}>
      {models.map((model) => {
        const dl = downloads[model.id];
        const downloading = dl != null && !TERMINAL_STATES.has(dl.state);
        const isSettingActive = settingActive === model.id;
        return (
          <li
            key={model.id}
            className={cn(
              "flex items-center gap-3 rounded border bg-bg-tertiary px-3 py-2",
              model.active
                ? "border-accent-primary/60"
                : "border-border-default",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-xs font-medium text-text-primary">
                  {model.name}
                </span>
                {model.active ? (
                  <Badge variant="success" size="sm">
                    <span className="inline-flex items-center gap-1">
                      <Crosshair className="h-2.5 w-2.5" />
                      {t("activeBadge")}
                    </span>
                  </Badge>
                ) : null}
                {model.custom ? (
                  <Badge variant="info" size="sm">
                    {t("customBadge")}
                  </Badge>
                ) : null}
                {model.task ? (
                  <span className="rounded border border-border-default px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
                    {model.task}
                  </span>
                ) : null}
                {!model.fits ? (
                  <Badge variant="warning" size="sm">
                    <span className="inline-flex items-center gap-1">
                      <Cpu className="h-2.5 w-2.5" />
                      {fitLabel(model.fitReason)}
                    </span>
                  </Badge>
                ) : null}
                {model.custom && model.customMeta && !model.customMeta.verified ? (
                  <Badge variant="warning" size="sm">
                    {t("unverifiedBadge")}
                  </Badge>
                ) : null}
              </div>
              {mode === "full" && model.description ? (
                <p className="truncate text-[11px] text-text-tertiary">
                  {model.description}
                </p>
              ) : null}
              {mode === "full" &&
              model.custom &&
              model.customMeta &&
              model.customMeta.classes.length > 0 ? (
                <p className="truncate text-[11px] text-text-tertiary">
                  {t("classesLine", {
                    classes: model.customMeta.classes.join(", "),
                  })}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!model.installed ? (
                downloading ? (
                  <span className="font-mono text-[11px] text-accent-primary">
                    {dl.state === "verifying"
                      ? t("verifying")
                      : `${Math.round(dl.percent)}%`}
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Download size={13} />}
                    onClick={() => startDownload(model.id)}
                  >
                    {t("download")}
                  </Button>
                )
              ) : model.active ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-status-success">
                  <CheckCircle2 size={13} />
                  {t("activeBadge")}
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setActive(model.id)}
                  loading={isSettingActive}
                  disabled={settingActive !== null || isHardBlocked}
                  title={isHardBlocked ? hardBlockMessage : undefined}
                >
                  {t("setActive")}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const uploadButton = (
    <Button
      variant="ghost"
      size="sm"
      icon={<Upload size={13} />}
      onClick={() => setUploadOpen(true)}
      disabled={isHardBlocked}
      title={isHardBlocked ? hardBlockMessage : undefined}
    >
      {t("upload")}
    </Button>
  );

  const errorBox = error ? (
    <div className="flex items-center gap-2 rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
      <AlertTriangle size={13} />
      {error}
    </div>
  ) : null;

  const emptyNote =
    !error && data && models.length === 0 ? (
      <p className="py-3 text-center text-xs text-text-tertiary">
        {t("emptyRegistry")}
      </p>
    ) : null;

  const engineNote =
    mode === "compact" ? (
      <p className="text-[10px] leading-tight text-text-tertiary">
        {t("engineWideNote")}
      </p>
    ) : null;

  const dialog = (
    <ModelUploadDialog
      open={uploadOpen}
      onClose={() => setUploadOpen(false)}
      onUpload={handleUpload}
      onUploaded={() => refresh()}
    />
  );

  if (mode === "compact") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          {/* The parent (ParameterControl) may already render the parameter
              label; suppress this header text then so the label isn't doubled.
              The empty span keeps the controls right-aligned via justify-between. */}
          {hideHeaderLabel ? (
            <span />
          ) : (
            <span className="text-xs text-text-secondary">{t("detector")}</span>
          )}
          <div className="flex items-center gap-1">
            {uploadButton}
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={12} />}
              onClick={refresh}
              disabled={loading}
            >
              {t("refresh")}
            </Button>
          </div>
        </div>
        {errorBox}
        {emptyNote}
        {!error && data ? rows : null}
        {engineNote}
        {dialog}
      </div>
    );
  }

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">
          {t("modelRegistry")}
        </h3>
        <div className="flex items-center gap-3">
          {data ? (
            <span className="font-mono text-[11px] text-text-tertiary">
              {t("cacheUsage", {
                used: data.cache.usedMb.toFixed(0),
                max: data.cache.maxMb.toFixed(0),
              })}
            </span>
          ) : null}
          {uploadButton}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={13} />}
            onClick={refresh}
            disabled={loading}
          >
            {t("refresh")}
          </Button>
        </div>
      </div>

      {errorBox}
      {emptyNote}
      {!error && data ? rows : null}
      {dialog}
    </section>
  );
}
