"use client";

/**
 * @module LcdCameraSwitch
 * @description Card that mirrors the agent's video/camera surface.
 * Shows every detected camera (CSI / USB / IP), highlights the
 * currently bound primary camera, and lets the operator switch the
 * primary binding to another device when 2+ cameras are present.
 *
 * Switching is optimistic: the new primary lights up immediately and
 * rolls back if the agent rejects the request. The card shows a
 * "Restarting..." indicator for ~3 s after a successful switch
 * because the agent restarts the encoder before the new feed
 * appears.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, RefreshCw, Loader2 } from "lucide-react";
import {
  Select,
  type SelectOption,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type {
  CameraEntry,
  CameraListResponse,
} from "@/lib/agent/client";
import { cn } from "@/lib/utils";

const RESTART_INDICATOR_MS = 3000;

function inferType(entry: CameraEntry): "CSI" | "USB" | "IP" | "Unknown" {
  const t = (entry.type ?? "").toLowerCase();
  if (t.includes("csi") || t.includes("mipi")) return "CSI";
  if (t.includes("usb") || t.includes("uvc")) return "USB";
  if (t.includes("ip") || t.includes("rtsp") || t.includes("onvif")) return "IP";
  const path = entry.device_path ?? "";
  if (path.startsWith("/dev/video")) return "USB";
  if (path.startsWith("rtsp://")) return "IP";
  return "Unknown";
}

function pickPrimary(
  cameras: ReadonlyArray<CameraEntry>,
  assignments: Record<string, unknown>,
): string | null {
  const raw = assignments["primary"];
  if (typeof raw === "string" && raw) return raw;
  // Fall back to the camera whose hardware_role is "primary".
  const tagged = cameras.find(
    (c) => (c.hardware_role ?? "").toLowerCase() === "primary",
  );
  if (tagged) return tagged.device_path;
  return null;
}

export function LcdCameraSwitch() {
  const client = useAgentConnectionStore((s) => s.client);
  const t = useTranslations("hardware.lcdCameraSwitch");
  const { toast } = useToast();

  const [cameras, setCameras] = useState<CameraEntry[]>([]);
  const [primaryPath, setPrimaryPath] = useState<string | null>(null);
  const [optimisticPrimary, setOptimisticPrimary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const fetchCameras = useCallback(
    async (mode: "load" | "refresh") => {
      if (!client) return;
      if (mode === "load") setLoading(true);
      else setRefreshing(true);
      try {
        const res: CameraListResponse = await client.listCameras();
        setCameras(res.cameras ?? []);
        setPrimaryPath(pickPrimary(res.cameras ?? [], res.assignments ?? {}));
      } catch (err) {
        const msg = err instanceof Error ? err.message : t("loadError");
        toast(msg, "error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client, t, toast],
  );

  // One-shot fetch on mount + whenever the agent client changes.
  useEffect(() => {
    if (!client) return;
    void fetchCameras("load");
  }, [client, fetchCameras]);

  // Drop the optimistic shadow when the agent confirms the new
  // assignment.
  useEffect(() => {
    if (optimisticPrimary && primaryPath === optimisticPrimary) {
      setOptimisticPrimary(null);
    }
  }, [primaryPath, optimisticPrimary]);

  const effectivePrimary = optimisticPrimary ?? primaryPath;
  const switchOptions = useMemo<SelectOption[]>(
    () =>
      cameras.map((c) => ({
        value: c.device_path,
        label: c.label ?? c.name ?? c.device_path,
        description: `${inferType(c)}${c.resolution ? ` - ${c.resolution}` : ""}`,
      })),
    [cameras],
  );

  const onSwitch = async (devicePath: string) => {
    if (!client || pending) return;
    if (devicePath === effectivePrimary) return;
    const previous = effectivePrimary;
    setOptimisticPrimary(devicePath);
    setPending(true);
    try {
      await client.switchCamera(devicePath);
      setRestarting(true);
      window.setTimeout(() => {
        setRestarting(false);
        // Re-fetch so the heartbeat-based assignment refreshes
        // even on agents that don't broadcast a new state push.
        void fetchCameras("refresh");
      }, RESTART_INDICATOR_MS);
    } catch (err) {
      setOptimisticPrimary(previous);
      const msg = err instanceof Error ? err.message : t("switchError");
      toast(msg, "error");
    } finally {
      setPending(false);
    }
  };

  const empty = !loading && cameras.length === 0;
  const single = cameras.length === 1;

  return (
    <section className="rounded border border-border-default bg-bg-secondary">
      <header className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <Camera size={16} className="text-accent-primary" />
          <h2 className="text-sm font-display font-semibold text-text-primary">
            {t("title")}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void fetchCameras("refresh")}
          disabled={!client || refreshing}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-text-secondary",
            "border border-border-default hover:border-accent-primary/40 hover:text-text-primary",
            (!client || refreshing) && "cursor-not-allowed opacity-60",
          )}
          aria-label={t("refresh")}
        >
          {refreshing ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t("refresh")}
        </button>
      </header>

      <div className="flex flex-col gap-3 px-4 py-4">
        {loading ? (
          <p className="text-xs text-text-tertiary">{t("loading")}</p>
        ) : empty ? (
          <p className="text-xs text-text-tertiary">{t("emptyDescription")}</p>
        ) : (
          <ul className="flex flex-col gap-2" role="list">
            {cameras.map((c) => {
              const isPrimary = c.device_path === effectivePrimary;
              return (
                <li
                  key={c.device_path}
                  data-camera-path={c.device_path}
                  data-primary={isPrimary}
                  className={cn(
                    "flex flex-col gap-1 rounded border px-3 py-2 text-xs",
                    isPrimary
                      ? "border-accent-primary/60 bg-accent-primary/10"
                      : "border-border-default bg-bg-tertiary",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text-primary">
                      {c.label ?? c.name ?? c.device_path}
                    </span>
                    {isPrimary ? (
                      <span
                        className="rounded bg-accent-primary/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-primary"
                        data-testid="primary-badge"
                      >
                        {t("primaryBadge")}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-text-secondary">
                    <span className="font-mono">{c.device_path}</span>
                    <span className="rounded border border-border-default px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
                      {inferType(c)}
                    </span>
                    {c.resolution ? (
                      <span className="text-[11px] text-text-tertiary">
                        {c.resolution}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!empty && !single ? (
          <div className="flex flex-col gap-2">
            <label className="text-[11px] text-text-secondary">
              {t("switchLabel")}
            </label>
            <div data-testid="camera-switch-select">
              <Select
                options={switchOptions}
                value={effectivePrimary ?? ""}
                onChange={(v) => void onSwitch(v)}
                disabled={!client || pending}
              />
            </div>
            {restarting ? (
              <p
                className="flex items-center gap-1.5 text-[11px] text-status-warning"
                data-testid="restarting-indicator"
              >
                <Loader2 size={12} className="animate-spin" />
                {t("restarting")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
