"use client";

/**
 * @module drone-detail/cameras/CameraManagerTab
 * @description The "Cameras" node-detail surface: declare what each camera on
 * this node is (mount, purpose, primary stream), assign discovered devices, and
 * add network cameras. Reads the reconciled roster from the agent, groups it by
 * state (Assigned / Discovered / Plugin-managed / Offline), and persists edits
 * as a whole declared-leg-list write. Roster reads/writes ride the direct LAN
 * client only (the config proxy does not forward them), so the tab resolves
 * read-only through the shared client-path check whenever no client is
 * attached — which includes cloud mode, where the client is detached.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Loader2, Plus, RefreshCw } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useCameraManagerStore } from "@/stores/camera-manager-store";
import { useToast } from "@/components/ui/toast";
import type { CameraLegInput, RosterCamera } from "@/lib/agent/feature-types";
import type { CameraPatch } from "@/lib/agent/camera-roster";
import { hasClientPath } from "@/lib/agent/config-access";
import {
  legsWithAdd,
  legsWithEdit,
  legsWithRemove,
  legsWithToggle,
} from "@/lib/agent/camera-roster";
import { isDemoMode, cn } from "@/lib/utils";
import { CameraCard } from "./CameraCard";
import { CameraEditor } from "./CameraEditor";
import { AddIpCameraDialog } from "./AddIpCameraDialog";

/** ~3 s pipeline restart window after a write (matches the agent's restart). */
const RESTART_MS = 3000;

const GROUPS: ReadonlyArray<{
  key: string;
  match: RosterCamera["state"];
}> = [
  { key: "assigned", match: "assigned" },
  { key: "discovered", match: "discovered_unassigned" },
  { key: "plugin", match: "plugin_owned" },
  { key: "offline", match: "offline" },
];

export function CameraManagerTab({ droneId }: { droneId: string }) {
  const t = useTranslations("cameras");
  const { toast } = useToast();
  const client = useAgentConnectionStore((s) => s.client);
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const videoStreams = useAgentCapabilitiesStore((s) => s.videoStreams);

  const state = useCameraManagerStore((s) => s.byDrone[droneId]);
  const beginLoad = useCameraManagerStore((s) => s.beginLoad);
  const setRoster = useCameraManagerStore((s) => s.setRoster);
  const fail = useCameraManagerStore((s) => s.fail);
  const patchCamera = useCameraManagerStore((s) => s.patchCamera);
  const setSaving = useCameraManagerStore((s) => s.setSaving);
  const setRestartPending = useCameraManagerStore((s) => s.setRestartPending);

  // Stable identity so it does not churn the callbacks / memos that read it.
  const roster = useMemo(() => state?.roster ?? [], [state?.roster]);
  const loading = state?.loading ?? false;
  const saving = state?.saving ?? false;
  const restartPending = state?.restartPending ?? false;
  const error = state?.error ?? null;
  const readOnly = !hasClientPath(client);

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Monotonic load token: a late-resolving earlier read must not clobber a
  // newer one. Only the most recently issued load applies its result.
  const loadTokenRef = useRef(0);
  // The pending post-write restart re-read timer, cleared on unmount so it
  // never resurrects a slice for a drone the operator has navigated away from.
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const token = (loadTokenRef.current += 1);
    beginLoad(droneId);
    try {
      const r = await client.getCameraRoster();
      if (loadTokenRef.current !== token) return; // superseded by a newer load
      setRoster(droneId, r);
    } catch (err) {
      if (loadTokenRef.current !== token) return;
      fail(droneId, err instanceof Error ? err.message : t("errorTitle"));
    }
  }, [client, droneId, beginLoad, setRoster, fail, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (restartTimerRef.current !== null) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
    },
    [],
  );

  const persist = useCallback(
    async (legs: CameraLegInput[]) => {
      // Writes are LAN-direct + local-first; never persist without a client
      // path even if a stray control slips through.
      if (!hasClientPath(client)) return;
      setSaving(droneId, true);
      try {
        await client.setCameraRoster(legs);
        setRestartPending(droneId, true);
        // The agent restarts the pipeline; re-read after so the roster shows
        // the true persisted + live state, not the optimistic bridge (Rule 44).
        if (restartTimerRef.current !== null) {
          clearTimeout(restartTimerRef.current);
        }
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          setRestartPending(droneId, false);
          void load();
        }, RESTART_MS);
      } catch (err) {
        toast(err instanceof Error ? err.message : t("saveError"), "error");
        void load();
      } finally {
        setSaving(droneId, false);
      }
    },
    [client, droneId, setSaving, setRestartPending, load, toast, t],
  );

  const onToggle = useCallback(
    (id: string, enabled: boolean) => {
      patchCamera(droneId, id, { enabled });
      void persist(legsWithToggle(roster, id, enabled));
    },
    [droneId, patchCamera, persist, roster],
  );

  const onRemove = useCallback(
    (id: string) => void persist(legsWithRemove(roster, id)),
    [persist, roster],
  );

  const onSaveEdit = useCallback(
    (id: string, patch: CameraPatch) => {
      setEditing(null);
      patchCamera(droneId, id, patch);
      void persist(legsWithEdit(roster, id, patch));
    },
    [droneId, patchCamera, persist, roster],
  );

  const onAdd = useCallback(
    (leg: CameraLegInput) => {
      setAdding(false);
      void persist(legsWithAdd(roster, leg));
    },
    [persist, roster],
  );

  // Best-effort live preview: match a leg to an addressable WHEP stream. Only on
  // a LAN-direct session (a hosted HTTPS origin would mixed-content-block the
  // LAN URL), and never in demo mode (no real stream).
  const whepById = useMemo(() => {
    const map = new Map<string, string>();
    if (cloudMode || isDemoMode()) return map;
    for (const s of videoStreams) {
      if (s.whepUrl && s.live !== false) map.set(s.id, s.whepUrl);
    }
    return map;
  }, [videoStreams, cloudMode]);

  const whepFor = useCallback(
    (cam: RosterCamera): string | null => {
      const direct = whepById.get(cam.id);
      if (direct) return direct;
      if (cam.role === "primary") return whepById.get("main") ?? null;
      return null;
    },
    [whepById],
  );

  const takenIds = useMemo(() => roster.map((c) => c.id), [roster]);
  const editingCamera = editing
    ? (roster.find((c) => c.id === editing) ?? null)
    : null;

  // One pass over the roster into per-state buckets instead of a fresh filter
  // per group on every render.
  const byState = useMemo(() => {
    const buckets = new Map<RosterCamera["state"], RosterCamera[]>();
    for (const c of roster) {
      const list = buckets.get(c.state);
      if (list) list.push(c);
      else buckets.set(c.state, [c]);
    }
    return buckets;
  }, [roster]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-default bg-bg-secondary px-4 py-3">
        <div className="flex items-center gap-2">
          <Camera size={16} className="text-accent-primary" />
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              {t("title")}
            </h2>
            <p className="text-xs text-text-tertiary">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {restartPending ? (
            <span className="flex items-center gap-1.5 text-[11px] text-status-warning">
              <Loader2 size={12} className="animate-spin" />
              {t("restarting")}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={!client || loading}
            className={cn(
              "flex items-center gap-1.5 rounded border border-border-default px-2 py-1 text-[11px] text-text-secondary hover:border-accent-primary/40 hover:text-text-primary",
              (!client || loading) && "cursor-not-allowed opacity-60",
            )}
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {t("refresh")}
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={readOnly || saving}
            className={cn(
              "flex items-center gap-1.5 rounded border border-accent-primary/40 bg-accent-primary/10 px-2 py-1 text-[11px] font-medium text-accent-primary hover:bg-accent-primary/20",
              (readOnly || saving) && "cursor-not-allowed opacity-60",
            )}
          >
            <Plus size={12} />
            {t("addIp")}
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {cloudMode ? (
          <p className="rounded border border-border-default bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
            {t("readOnlyNotice")}
          </p>
        ) : null}

        {error ? (
          <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
            <p className="font-medium">{t("errorTitle")}</p>
            <p className="mt-0.5 opacity-90">{error}</p>
          </div>
        ) : null}

        {loading && roster.length === 0 ? (
          <p className="text-xs text-text-tertiary">{t("loading")}</p>
        ) : !loading && roster.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-default p-8 text-center">
            <Camera className="h-6 w-6 text-text-tertiary" aria-hidden />
            <p className="text-sm text-text-primary">{t("empty")}</p>
          </div>
        ) : (
          GROUPS.map(({ key, match }) => {
            const cams = byState.get(match) ?? [];
            if (cams.length === 0) return null;
            return (
              <section key={key} className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-text-secondary">
                    {t(`groups.${key}`)}
                  </h3>
                  <span className="text-[11px] text-text-tertiary">
                    {t(`groupHint.${key}`)}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {cams.map((cam) => (
                    <CameraCard
                      key={cam.id}
                      camera={cam}
                      whepUrl={whepFor(cam)}
                      readOnly={readOnly}
                      onEdit={setEditing}
                      onToggle={onToggle}
                      onRemove={onRemove}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>

      {editingCamera ? (
        <CameraEditor
          camera={editingCamera}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={onSaveEdit}
        />
      ) : null}

      {adding ? (
        <AddIpCameraDialog
          takenIds={takenIds}
          saving={saving}
          onClose={() => setAdding(false)}
          onAdd={onAdd}
        />
      ) : null}
    </div>
  );
}
