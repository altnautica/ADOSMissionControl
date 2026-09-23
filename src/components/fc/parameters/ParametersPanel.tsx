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
import { useState, useCallback, useEffect, useMemo } from "react";
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
import { useDroneManager } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { resolveParamDocContext, type ParamDocContext } from "@/lib/protocol/param-docs";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useMqttControlAuthority } from "@/hooks/use-mqtt-control-authority";
import { useControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { cn } from "@/lib/utils";
import { ListTree, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useParameterEdits } from "./use-parameter-edits";

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
  const {
    parameters, metadata, loading, progress, error, downloadParams,
    modified, fcParamMap, saving, writeProgress, writeChanges,
    showRebootPrompt, setShowRebootPrompt,
    stage: handleModify, revert: handleRevert, writeStaged, resetToDefaults, reboot: handleReboot,
    exportMissionPlanner: handleExport, exportQgc: handleExportQgc,
  } = useParameterEdits();
  const [filter, setFilter] = useState("");
  const debouncedFilter = useDebouncedValue(filter, 150);
  const [category, setCategory] = useState<string | null>(null);
  const [showModifiedOnly, setShowModifiedOnly] = useState(false);
  const [showNonDefault, setShowNonDefault] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showWriteConfirm, setShowWriteConfirm] = useState(false);
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

  const docContext = useMemo((): ParamDocContext | null => {
    if (!vehicleInfo) return null;
    return resolveParamDocContext(
      vehicleInfo.firmwareType,
      vehicleInfo.firmwareVersionString,
      vehicleInfo.vehicleClass,
    );
  }, [vehicleInfo, selectedDroneId]);

  useEffect(() => {
    if (pendingParamSearch) {
      setFilter(pendingParamSearch); setCategory(null);
      setShowModifiedOnly(false); setShowFavorites(false); setShowNonDefault(false);
      setPendingParamSearch(null);
    }
  }, [pendingParamSearch, setPendingParamSearch]);

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

  const handleSave = useCallback(() => {
    if (modified.size > 0) setShowWriteConfirm(true);
  }, [modified]);

  const doWrite = useCallback(async () => {
    setShowWriteConfirm(false);
    await writeStaged();
  }, [writeStaged]);

  const handleResetConfirm = useCallback(async () => {
    setShowResetConfirm(false);
    await resetToDefaults();
  }, [resetToDefaults]);

  // Re-read the vehicle whenever any compare write landed; close the compare
  // view only when all of it did, so the failures stay in front of the operator.
  const handleCompareApplied = useCallback(({ allLanded, rebootRequired }: ParamCompareApplied) => {
    if (allLanded) setShowCompare(false);
    if (rebootRequired) setShowRebootPrompt(true);
    downloadParams();
  }, [downloadParams, setShowRebootPrompt]);

  return (
    <ArmedWarningBanner className="h-full overflow-hidden">
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
    </ArmedWarningBanner>
  );
}
