"use client";

/**
 * The raw parameter grid: every parameter on the vehicle, uncurated.
 *
 * It writes through the same contract as the curated FC panels — the armed
 * confirmation, the unsaved-change guard, the pending-write/reboot records, and
 * the shared panel header — rather than its own weaker one. It keeps its own
 * loader because it downloads the whole parameter set in one streamed pass,
 * which is a different job from `usePanelParams`' fixed named list.
 *
 * @module fc/parameters/ParametersPanel
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { ParameterGrid } from "./ParameterGrid";
import { WriteConfirmDialog } from "../shared/WriteConfirmDialog";
import { ParameterSearchFilter } from "./ParameterSearchFilter";
import { ParamCompare, type ParamCompareApplied } from "./ParamCompare";
import { ParamDefaultsDiff } from "./ParamDefaultsDiff";
import { FavoritesQuickAccess } from "./FavoritesQuickAccess";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { loadParamMetadata, type ParamMetadata } from "@/lib/protocol/param-metadata";
import { resolveParamDocContext, type ParamDocContext } from "@/lib/protocol/param-docs";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useMqttControlAuthority } from "@/hooks/use-mqtt-control-authority";
import { useControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { confirmArmedParamWrite, describeParamBatch, writeParamBatch } from "@/lib/protocol/param-write";
import { cn } from "@/lib/utils";
import { ListTree, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { ParameterValue, DroneProtocol } from "@/lib/protocol/types";
import { exportParamFile } from "./param-file-io";

/**
 * Panel id every write from this surface is attributed to, in the armed-confirm
 * dialog and the pending-write records. The FC panels use their own ids.
 */
const PANEL_ID = "parameters";

/** Module-level cache — survives unmount/remount, avoids full re-download on navigation. */
let cachedParamList: ParameterValue[] | null = null;
let cacheTimestamp = 0;
const PARAM_LIST_CACHE_TTL = 300_000;

/** Invalidate the param cache (call on FC disconnect/reconnect). */
export function invalidateParamCache(): void {
  cachedParamList = null;
  cacheTimestamp = 0;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function getCategory(name: string): string {
  const idx = name.indexOf("_");
  if (idx === -1) return name;
  return name.slice(0, idx).replace(/\d+$/, "");
}

/** Debounce hook — returns debounced value after delay ms */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function ParametersPanel() {
  const t = useTranslations("parameters");
  const { toast } = useToast();
  const [parameters, setParameters] = useState<ParameterValue[]>([]);
  const [modified, setModified] = useState<Map<string, number>>(new Map());
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 150);
  const [category, setCategory] = useState<string | null>(null);
  const [showModifiedOnly, setShowModifiedOnly] = useState(false);
  const [showNonDefault, setShowNonDefault] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [writeProgress, setWriteProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Map<string, ParamMetadata>>(new Map());
  const [showWriteConfirm, setShowWriteConfirm] = useState(false);
  const [showRebootPrompt, setShowRebootPrompt] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showDefaultsDiff, setShowDefaultsDiff] = useState(false);
  const columnVisibility = useSettingsStore((s) => s.paramColumns);
  const favoriteParams = useSettingsStore((s) => s.favoriteParams);
  const pendingParamSearch = useUiStore((s) => s.pendingParamSearch);
  const setPendingParamSearch = useUiStore((s) => s.setPendingParamSearch);
  // Subscribe to selected drone vehicleInfo so docs links update when connect/select changes.
  // vehicleInfo is replaced on connect; also depend on selectedDroneId so selection swaps update.
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const vehicleInfo = useDroneManager((s) => {
    const id = s.selectedDroneId;
    if (!id) return null;
    return s.drones.get(id)?.vehicleInfo ?? null;
  });

  const selectedProtocol = useDroneManager((s) => {
    const id = s.selectedDroneId;
    if (!id) return null;
    return s.drones.get(id)?.protocol ?? null;
  });

  // The four FC panel conventions. `useArmedLock` gates the one control here
  // that is genuinely unsafe in flight (a full factory reset of every
  // parameter); individual writes stay allowed behind the armed confirmation,
  // exactly as in every other panel. `PanelHeader` and the shared write path
  // are used below.
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  useUnsavedGuard(modified.size > 0);
  // On a cloud relay with no write grant, a parameter write is published into a
  // broker that discards it and nothing fails. The panel says so before the
  // operator stages forty edits.
  const authority = useControlAuthorityNotice(useMqttControlAuthority());
  const prevProtocolRef = useRef<DroneProtocol | null>(null);

  const docContext = useMemo((): ParamDocContext | null => {
    if (!vehicleInfo) return null;
    return resolveParamDocContext(
      vehicleInfo.firmwareType,
      vehicleInfo.firmwareVersionString,
      vehicleInfo.vehicleClass,
    );
  }, [vehicleInfo, selectedDroneId]);

  // Throttled progress ref — update UI at most every 100ms during download
  const lastProgressUpdate = useRef(0);

  const downloadParams = useCallback(async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) { setError(t("noDroneConnected")); return; }
    setLoading(true); setError(null); setProgress({ current: 0, total: 0 });
    setModified(new Map());
    // Keyed by param index, not a raw per-frame counter: a lossy link makes
    // the GCS re-request missing indices and the FC itself may retransmit,
    // so the same index can legitimately arrive more than once during one
    // download. A plain push-per-callback counter double-counts every
    // retransmission and can run past the real total (seen live: "1452/1111,
    // 131%"). Overwriting by index mirrors the adapter's own dedup so the
    // displayed count can never exceed reality.
    const receivedByIndex = new Map<number, ParameterValue>();
    // A stray or malformed frame (no request-correlation id exists in
    // PARAM_VALUE to rule one out) can report an index outside its own
    // count — e.g. a real one seen live, `index=65535,count=1`. A real
    // indexed parameter always satisfies 0 <= index < count; anything else
    // is display noise, not progress, and must not blip the total downward
    // mid-download.
    const unsub = protocol.onParameter((param) => {
      if (param.index < 0 || param.index >= param.count) return;
      receivedByIndex.set(param.index, param);
      const now = Date.now();
      if (now - lastProgressUpdate.current >= 100 || receivedByIndex.size === param.count) {
        lastProgressUpdate.current = now;
        setProgress({ current: receivedByIndex.size, total: param.count || receivedByIndex.size });
      }
    });
    try {
      const params = await protocol.getAllParameters();
      params.sort((a, b) => collator.compare(a.name, b.name));
      cachedParamList = params; cacheTimestamp = Date.now(); setParameters(params);
    } catch (err) { setError(err instanceof Error ? err.message : t("downloadFailed")); }
    finally { unsub(); setLoading(false); }
  }, []);

  useEffect(() => {
    const protocolChanged =
      selectedProtocol !== null &&
      prevProtocolRef.current !== null &&
      selectedProtocol !== prevProtocolRef.current;
    if (selectedProtocol !== null) prevProtocolRef.current = selectedProtocol;
    if (protocolChanged) invalidateParamCache();

    if (cachedParamList && Date.now() - cacheTimestamp < PARAM_LIST_CACHE_TTL) { setParameters(cachedParamList); }
    else { downloadParams(); }
    const drone = useDroneManager.getState().getSelectedDrone();
    if (drone?.vehicleInfo) {
      loadParamMetadata({
        firmwareType: drone.vehicleInfo.firmwareType,
        vehicleClass: drone.vehicleInfo.vehicleClass,
        firmwareVersion: drone.vehicleInfo.firmwareVersionString,
        protocol: drone.protocol,
      }).then(setMetadata);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProtocol]);

  useEffect(() => {
    if (pendingParamSearch) {
      setFilter(pendingParamSearch); setCategory(null);
      setShowModifiedOnly(false); setShowFavorites(false); setShowNonDefault(false);
      setPendingParamSearch(null);
    }
  }, [pendingParamSearch, setPendingParamSearch]);

  // Pre-built Map for O(1) lookups instead of O(n) .find() calls
  const paramsByName = useMemo(() => {
    const map = new Map<string, ParameterValue>();
    for (const p of parameters) map.set(p.name, p);
    return map;
  }, [parameters]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of parameters) { const cat = getCategory(p.name); map.set(cat, (map.get(cat) || 0) + 1); }
    return Array.from(map.entries()).sort(([a], [b]) => collator.compare(a, b));
  }, [parameters]);

  const filteredParams = useMemo(() => {
    let result = parameters;
    if (category) result = result.filter((p) => getCategory(p.name) === category);
    if (showNonDefault) {
      result = result.filter((p) => {
        const meta = metadata.get(p.name);
        if (meta?.defaultValue === undefined) return false;
        const current = modified.has(p.name) ? modified.get(p.name)! : p.value;
        return current !== meta.defaultValue;
      });
    }
    if (showFavorites) result = result.filter((p) => favoriteParams.includes(p.name));
    return result;
  }, [parameters, category, showNonDefault, showFavorites, favoriteParams, modified, metadata]);

  const handleModify = useCallback((name: string, value: number) => {
    setModified((prev) => {
      const original = paramsByName.get(name);
      if (original && original.value === value) { const next = new Map(prev); next.delete(name); return next; }
      return new Map(prev).set(name, value);
    });
  }, [paramsByName]);

  const handleSave = useCallback(async () => {
    if (modified.size === 0) return;
    setShowWriteConfirm(true);
  }, [modified]);

  const doWrite = useCallback(async () => {
    setShowWriteConfirm(false);
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol || modified.size === 0) return;

    const entries = Array.from(modified.entries());
    // Armed-write guard, the same one every FC panel pops: an armed vehicle
    // gets an explicit confirmation naming the parameters about to change.
    const confirmed = await confirmArmedParamWrite(
      PANEL_ID,
      entries.map(([name]) => name),
    );
    if (!confirmed) return;

    setSaving(true); setError(null);
    // Which names the FC actually acknowledged. A lossy link makes a batch
    // PARTIALLY land, and the grid has to show the vehicle's real state: the
    // writes that succeeded are no longer pending, and the ones that failed
    // still are. Reporting the whole batch as failed left all N rows marked
    // modified with their old values, so Save re-wrote what had already landed
    // and Revert silently discarded the record that the vehicle had changed.
    setWriteProgress({ current: 0, total: entries.length });
    const outcome = await writeParamBatch(
      protocol,
      entries.map(([name, value]) => ({
        name,
        value,
        oldValue: paramsByName.get(name)?.value ?? 0,
        rebootRequired: metadata.get(name)?.rebootRequired,
      })),
      PANEL_ID,
      (current, total) => setWriteProgress({ current, total }),
    );
    const { written, failures } = outcome;

    // Commit what landed, whether or not the rest did.
    if (written.size > 0) {
      setParameters((prev) => {
        const updated = prev.map((p) => {
          const nv = modified.get(p.name);
          return written.has(p.name) && nv !== undefined ? { ...p, value: nv } : p;
        });
        cachedParamList = updated; cacheTimestamp = Date.now(); return updated;
      });
      setModified((prev) => {
        const next = new Map(prev);
        for (const name of written) next.delete(name);
        return next;
      });
    }

    if (failures.length > 0) {
      setError(`Failed to write ${failures.length} of ${entries.length} param(s): ${failures.join(", ")}`);
    }

    const summary = describeParamBatch(outcome);
    toast(summary.message, summary.level);
    // Only the parameters that landed can require a reboot.
    if (outcome.rebootRequired) setShowRebootPrompt(true);
    setSaving(false); setWriteProgress({ current: 0, total: 0 });
  }, [modified, paramsByName, metadata, toast]);

  const writeChanges = useMemo(() => Array.from(modified.entries()).map(([name, newValue]) => ({
    name, oldValue: paramsByName.get(name)?.value ?? 0, newValue,
  })), [modified, paramsByName]);

  const handleRevert = useCallback(() => { setModified(new Map()); }, []);

  /** The reboot the "parameters need a restart" prompt offers. The FC can
   * refuse the command (wrong mode, armed, unsupported); closing the dialog on
   * a refusal reads as a reboot that happened, so report the refusal. */
  const handleReboot = useCallback(async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) { setShowRebootPrompt(false); return; }
    try {
      const result = await protocol.reboot();
      if (!result.success) {
        toast(result.message || "The FC refused the reboot command", "error");
      }
    } catch {
      toast("Reboot command failed", "error");
    } finally {
      setShowRebootPrompt(false);
    }
  }, [toast]);

  const handleResetConfirm = useCallback(async () => {
    setShowResetConfirm(false);
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) { setError(t("noDroneConnected")); return; }
    setSaving(true); setError(null);
    try {
      const result = await protocol.resetParametersToDefault();
      if (result.success) { await new Promise((r) => setTimeout(r, 1000)); await downloadParams(); setShowRebootPrompt(true); }
      else { setError(`Reset failed: ${result.message}`); }
    } catch (err) { setError(err instanceof Error ? err.message : "Reset command failed"); }
    finally { setSaving(false); }
  }, [downloadParams]);

  const fcParamMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of parameters) map.set(p.name, modified.has(p.name) ? modified.get(p.name)! : p.value);
    return map;
  }, [parameters, modified]);

  // Re-read the vehicle whenever any compare write landed; close the compare
  // view only when all of it did, so the failures stay in front of the operator.
  const handleCompareApplied = useCallback(({ allLanded, rebootRequired }: ParamCompareApplied) => {
    if (allLanded) setShowCompare(false);
    if (rebootRequired) setShowRebootPrompt(true);
    downloadParams();
  }, [downloadParams]);

  const handleExport = useCallback(() => {
    exportParamFile(parameters, modified, { format: "mp" });
  }, [parameters, modified]);

  const handleExportQgc = useCallback(() => {
    const vi = useDroneManager.getState().getSelectedDrone()?.vehicleInfo;
    exportParamFile(parameters, modified, {
      format: "qgc",
      systemId: vi?.systemId ?? 1,
      componentId: vi?.componentId ?? 1,
    });
  }, [parameters, modified]);

  return (
    <ArmedLockOverlay className="h-full overflow-hidden">
      <div className="flex-shrink-0 border-b border-border-default bg-bg-secondary px-4 py-3">
        <PanelHeader
          title={t("title")}
          icon={<SlidersHorizontal size={16} />}
          loading={loading}
          loadProgress={
            progress.total > 0
              ? { loaded: progress.current, total: progress.total }
              : null
          }
          hasLoaded={parameters.length > 0}
          onRead={downloadParams}
          connected={selectedProtocol !== null}
          error={error}
        >
          {parameters.length > 0 && (
            <Badge variant="info" size="sm">{t("totalParams", { count: parameters.length })}</Badge>
          )}
          {modified.size > 0 && (
            <Badge variant="warning" size="sm">{t("modifiedCount", { count: modified.size })}</Badge>
          )}
        </PanelHeader>
        {/* A write that cannot leave this browser must be said before the
            operator stages a batch, not after it silently lands nowhere. */}
        {authority.show && (
          <p role="alert" className="mt-2 text-[11px] leading-snug text-status-warning">
            {authority.detail}
          </p>
        )}
      </div>

      <ParameterSearchFilter filter={filter} onFilterChange={setFilter}
        showModifiedOnly={showModifiedOnly} onToggleModified={() => setShowModifiedOnly(!showModifiedOnly)}
        showNonDefault={showNonDefault} onToggleNonDefault={() => setShowNonDefault(!showNonDefault)}
        showFavorites={showFavorites} onToggleFavorites={() => setShowFavorites(!showFavorites)}
        paramCount={parameters.length} modifiedCount={modified.size}
        loading={loading} saving={saving} progress={progress} writeProgress={writeProgress}
        onExport={handleExport} onExportQgc={handleExportQgc} onCompare={() => setShowCompare(true)}
        onDefaultsDiff={() => setShowDefaultsDiff(true)}
        onRevert={handleRevert} onResetDefaults={() => setShowResetConfirm(true)}
        resetBlocked={isHardBlocked} resetBlockedReason={hardBlockMessage}
        onSave={handleSave} />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {!loading && parameters.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <ListTree size={32} strokeWidth={1.5} />
            <p className="text-sm">{t("noParamsLoaded")}</p>
            <Button variant="secondary" size="sm" icon={<RefreshCw size={12} />} onClick={downloadParams}>{t("downloadFromFc")}</Button>
          </div>
        ) : (
          <>
            {parameters.length > 0 && (
              <nav className="w-[180px] flex-shrink-0 border-r border-border-default bg-bg-secondary overflow-y-auto">
                <div className="px-3 py-2 border-b border-border-default">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{t("categories")}</span>
                </div>
                <div className="flex flex-col py-1">
                  <button onClick={() => setCategory(null)}
                    className={cn("flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors cursor-pointer",
                      category === null ? "text-accent-primary bg-accent-primary/10 border-l-2 border-l-accent-primary" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border-l-2 border-l-transparent")}>
                    <span>{t("all")}</span><span className="text-[10px] text-text-tertiary font-mono">{parameters.length}</span>
                  </button>
                  {categories.map(([cat, count]) => (
                    <button key={cat} onClick={() => setCategory(cat)}
                      className={cn("flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors cursor-pointer",
                        category === cat ? "text-accent-primary bg-accent-primary/10 border-l-2 border-l-accent-primary" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border-l-2 border-l-transparent")}>
                      <span className="font-mono truncate">{cat}</span><span className="text-[10px] text-text-tertiary font-mono ml-1">{count}</span>
                    </button>
                  ))}
                </div>
              </nav>
            )}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {favoriteParams.length > 0 && !showFavorites && (
                <FavoritesQuickAccess parameters={parameters} favoriteParams={favoriteParams}
                  modified={modified} onModify={handleModify} metadata={metadata} columnVisibility={columnVisibility} />
              )}
              <ParameterGrid parameters={filteredParams} modified={modified} onModify={handleModify}
                filter={debouncedFilter} showModifiedOnly={showModifiedOnly} metadata={metadata} columnVisibility={columnVisibility}
                docContext={docContext} docsLinkLabel={t("docsLink")} />
            </div>
          </>
        )}
      </div>

      <WriteConfirmDialog open={showWriteConfirm} onCancel={() => setShowWriteConfirm(false)} onConfirm={doWrite} changes={writeChanges} metadata={metadata} />
      <ConfirmDialog open={showResetConfirm} onCancel={() => setShowResetConfirm(false)} onConfirm={handleResetConfirm}
        title={t("resetTitle")} message={t("resetMessage")}
        confirmLabel={t("resetConfirmLabel")} variant="danger" />
      <Modal open={showCompare} onClose={() => setShowCompare(false)} title={t("compareTitle")} className="max-w-3xl">
        <ParamCompare fcParams={fcParamMap} metadata={metadata} onApplied={handleCompareApplied} />
      </Modal>
      <Modal open={showDefaultsDiff} onClose={() => setShowDefaultsDiff(false)} title={t("compareDefaults")} className="max-w-3xl">
        <ParamDefaultsDiff parameters={parameters} modified={modified} metadata={metadata} />
      </Modal>
      <ConfirmDialog open={showRebootPrompt} onCancel={() => setShowRebootPrompt(false)}
        onConfirm={handleReboot}
        title={t("rebootTitle")} message={t("rebootMessage")}
        confirmLabel={t("rebootConfirmLabel")} variant="primary" />
    </ArmedLockOverlay>
  );
}
