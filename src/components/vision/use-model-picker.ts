import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useToast } from "@/components/ui/toast";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { isDemoMode } from "@/lib/utils";
import { resolveVisionClient } from "@/lib/vision/resolve-vision-client";
import { filterModelsForBoard, type FilteredModel } from "@/lib/vision/model-filter";
import type { VisionClient, VisionModelsResponse } from "@/lib/agent/vision-client";
import { setEngineDetector, uploadEngineModel } from "@/lib/skills/vision-detector-writer";
import { POLL_INTERVAL_MS, TERMINAL_STATES, type DownloadState } from "./model-picker-labels";

/**
 * State and actions of the model picker: the board-filtered model list, the
 * download pollers, the active-detector write and the custom upload.
 */
export function useModelPicker(
  droneId: string,
  onActiveChange: ((modelId: string) => void) | undefined,
) {
  const t = useTranslations("vision");
  const { toast } = useToast();
  // The arm lock reads the picker's own drone, never whichever drone is
  // selected elsewhere.
  const { isHardBlocked, hardBlockMessage } = useArmedLock(droneId);
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

  return {
    isHardBlocked,
    hardBlockMessage,
    data,
    loading,
    error,
    downloads,
    settingActive,
    uploadOpen,
    setUploadOpen,
    models,
    refresh,
    startDownload,
    setActive,
    handleUpload,
  };
}
