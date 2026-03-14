"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { ParameterGrid } from "./ParameterGrid";
import { WriteConfirmDialog } from "../shared/WriteConfirmDialog";
import { ParameterSearchFilter } from "./ParameterSearchFilter";
import { ParamCompare } from "./ParamCompare";
import { ParamDefaultsDiff } from "./ParamDefaultsDiff";
import { FavoritesQuickAccess } from "./FavoritesQuickAccess";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { getParamMetadata, firmwareTypeToVehicle, type ParamMetadata } from "@/lib/protocol/param-metadata";
import { cn } from "@/lib/utils";
import { RefreshCw, ListTree } from "lucide-react";
import type { ParameterValue } from "@/lib/protocol/types";
import { exportParamFile } from "./param-file-io";

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

  // Throttled progress ref — update UI at most every 100ms during download
  const lastProgressUpdate = useRef(0);

  const downloadParams = useCallback(async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) { setError("No drone connected"); return; }
    setLoading(true); setError(null); setProgress({ current: 0, total: 0 });
    setModified(new Map());
    const received: ParameterValue[] = [];
    const unsub = protocol.onParameter((param) => {
      received.push(param);
      const now = Date.now();
      if (now - lastProgressUpdate.current >= 100 || received.length === param.count) {
        lastProgressUpdate.current = now;
        setProgress({ current: received.length, total: param.count || received.length });
      }
    });
    try {
      const params = await protocol.getAllParameters();
      params.sort((a, b) => collator.compare(a.name, b.name));
      cachedParamList = params; cacheTimestamp = Date.now(); setParameters(params);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to download parameters"); }
    finally { unsub(); setLoading(false); }
  }, []);

  useEffect(() => {
    if (cachedParamList && Date.now() - cacheTimestamp < PARAM_LIST_CACHE_TTL) { setParameters(cachedParamList); }
    else { downloadParams(); }
    const drone = useDroneManager.getState().getSelectedDrone();
    if (drone?.vehicleInfo) {
      const vehicle = firmwareTypeToVehicle(drone.vehicleInfo.firmwareType);
      if (vehicle) { getParamMetadata(vehicle).then(setMetadata); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setSaving(true); setError(null);
    const failures: string[] = [];
    const entries = Array.from(modified.entries());
    setWriteProgress({ current: 0, total: entries.length });
    for (let i = 0; i < entries.length; i++) {
      const [name, value] = entries[i];
      setWriteProgress({ current: i + 1, total: entries.length });
      const param = paramsByName.get(name);
      try {
        const result = await protocol.setParameter(name, value, param?.type);
        if (!result.success) failures.push(`${name}: ${result.message}`);
      } catch { failures.push(`${name}: write failed`); }
    }
    if (failures.length > 0) {
      setError(`Failed to write ${failures.length} param(s): ${failures.join(", ")}`);
      toast(`Failed to write ${failures.length} parameter(s)`, "error");
    } else {
      const needsReboot = entries.some(([name]) => metadata.get(name)?.rebootRequired);
      setParameters((prev) => {
        const updated = prev.map((p) => { const nv = modified.get(p.name); return nv !== undefined ? { ...p, value: nv } : p; });
        cachedParamList = updated; cacheTimestamp = Date.now(); return updated;
      });
      setModified(new Map());
      toast(`Wrote ${entries.length} parameter(s) to FC`, "success");
      // Auto-commit to flash (belt-and-suspenders, fire-and-forget per DEC-047)
      try { protocol.commitParamsToFlash(); } catch { /* fire-and-forget */ }
      if (needsReboot) setShowRebootPrompt(true);
    }
    setSaving(false); setWriteProgress({ current: 0, total: 0 });
  }, [modified, paramsByName, metadata, toast]);

  const writeChanges = useMemo(() => Array.from(modified.entries()).map(([name, newValue]) => ({
    name, oldValue: paramsByName.get(name)?.value ?? 0, newValue,
  })), [modified, paramsByName]);

  const handleRevert = useCallback(() => { setModified(new Map()); }, []);

  const handleResetConfirm = useCallback(async () => {
    setShowResetConfirm(false);
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) { setError("No drone connected"); return; }
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

  const handleCompareApplied = useCallback(() => { setShowCompare(false); downloadParams(); }, [downloadParams]);

  const handleExport = useCallback(() => {
    exportParamFile(parameters, modified);
  }, [parameters, modified]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <ParameterSearchFilter filter={filter} onFilterChange={setFilter}
        showModifiedOnly={showModifiedOnly} onToggleModified={() => setShowModifiedOnly(!showModifiedOnly)}
        showNonDefault={showNonDefault} onToggleNonDefault={() => setShowNonDefault(!showNonDefault)}
        showFavorites={showFavorites} onToggleFavorites={() => setShowFavorites(!showFavorites)}
        paramCount={parameters.length} modifiedCount={modified.size}
        loading={loading} saving={saving} progress={progress} writeProgress={writeProgress}
        error={error} onDismissError={() => setError(null)}
        onExport={handleExport} onCompare={() => setShowCompare(true)}
        onDefaultsDiff={() => setShowDefaultsDiff(true)}
        onRevert={handleRevert} onResetDefaults={() => setShowResetConfirm(true)}
        onSave={handleSave} onRefresh={downloadParams} />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {!loading && parameters.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <ListTree size={32} strokeWidth={1.5} />
            <p className="text-sm">No parameters loaded</p>
            <Button variant="secondary" size="sm" icon={<RefreshCw size={12} />} onClick={downloadParams}>Download from FC</Button>
          </div>
        ) : (
          <>
            {parameters.length > 0 && (
              <nav className="w-[180px] flex-shrink-0 border-r border-border-default bg-bg-secondary overflow-y-auto">
                <div className="px-3 py-2 border-b border-border-default">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Categories</span>
                </div>
                <div className="flex flex-col py-1">
                  <button onClick={() => setCategory(null)}
                    className={cn("flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors cursor-pointer",
                      category === null ? "text-accent-primary bg-accent-primary/10 border-l-2 border-l-accent-primary" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border-l-2 border-l-transparent")}>
                    <span>All</span><span className="text-[10px] text-text-tertiary font-mono">{parameters.length}</span>
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
                filter={debouncedFilter} showModifiedOnly={showModifiedOnly} metadata={metadata} columnVisibility={columnVisibility} />
            </div>
          </>
        )}
      </div>

      <WriteConfirmDialog open={showWriteConfirm} onCancel={() => setShowWriteConfirm(false)} onConfirm={doWrite} changes={writeChanges} metadata={metadata} />
      <ConfirmDialog open={showResetConfirm} onCancel={() => setShowResetConfirm(false)} onConfirm={handleResetConfirm}
        title="Reset to Factory Defaults" message="This will reset ALL parameters to firmware defaults. You will need to re-calibrate sensors afterward. The flight controller will require a reboot."
        confirmLabel="Reset All Parameters" variant="danger" />
      <Modal open={showCompare} onClose={() => setShowCompare(false)} title="Parameter Compare" className="max-w-3xl">
        <ParamCompare fcParams={fcParamMap} onApplied={handleCompareApplied} />
      </Modal>
      <Modal open={showDefaultsDiff} onClose={() => setShowDefaultsDiff(false)} title="Compare to Defaults" className="max-w-3xl">
        <ParamDefaultsDiff parameters={parameters} modified={modified} metadata={metadata} />
      </Modal>
      <ConfirmDialog open={showRebootPrompt} onCancel={() => setShowRebootPrompt(false)}
        onConfirm={async () => { const protocol = useDroneManager.getState().getSelectedProtocol(); if (protocol) await protocol.reboot(); setShowRebootPrompt(false); }}
        title="Reboot Required" message="Some parameters you changed require a flight controller reboot to take effect. Reboot now?"
        confirmLabel="Reboot FC" variant="primary" />
    </div>
  );
}
