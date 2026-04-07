import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { usePanelCacheStore } from "@/stores/panel-cache-store";
import { useFcPanelActionsStore } from "@/stores/fc-panel-actions-store";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { cachePanelToIDB, getCachedPanelFromIDB } from "@/lib/param-cache-idb";
import type { PanelParamOptions, PanelParamState, PanelParamActions, UndoEntry } from "./use-panel-params-types";
import { MAX_UNDO_STACK, RETRY_DELAYS, DEFAULT_BATCH_SIZE, EMPTY_ARRAY } from "./use-panel-params-types";

export type { PanelParamOptions, PanelParamState, PanelParamActions, PanelParamEvent } from "./use-panel-params-types";

export function usePanelParams(
  options: PanelParamOptions,
): PanelParamState & PanelParamActions {
  const { paramNames, optionalParams = EMPTY_ARRAY, panelId, autoLoad = false, maxRetries = 3, batchSize = DEFAULT_BATCH_SIZE, onEvent, metadata: externalMetadata } = options;
  const optionalSet = useMemo(() => new Set(optionalParams), [optionalParams]);

  const [params, setParams] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirtyParams, setDirtyParams] = useState<Set<string>>(new Set());
  const [hasRamWrites, setHasRamWrites] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [missingOptional, setMissingOptional] = useState<Set<string>>(new Set());
  const [idbCacheTimestamp, setIdbCacheTimestamp] = useState<number | null>(null);

  const originalValues = useRef<Map<string, number>>(new Map());
  const undoStack = useRef<UndoEntry[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const abortedRef = useRef(false);

  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const trackWrite = useParamSafetyStore((s) => s.trackWrite);
  const trackRebootParam = useParamSafetyStore((s) => s.trackRebootParam);
  const commitFlashStore = useParamSafetyStore((s) => s.commitFlash);
  const markPanelLoaded = useParamSafetyStore((s) => s.markPanelLoaded);
  const cachePanel = usePanelCacheStore((s) => s.cachePanel);
  const getCachedPanel = usePanelCacheStore((s) => s.getCachedPanel);

  const loadParams = useCallback(async () => {
    const protocol = getProtocol();
    if (!protocol || !protocol.isConnected) {
      const msg = "Not connected to flight controller";
      setError(msg);
      onEvent?.({ type: "error", message: msg });
      return;
    }

    setLoading(true);
    setError(null);
    setLoadProgress({ loaded: 0, total: paramNames.length });
    onEvent?.({ type: "info", message: `Loading ${paramNames.length} parameters...` });

    const loaded = new Map<string, number>();
    const failed: string[] = [];
    let completedCount = 0;

    const fetchOne = async (name: string): Promise<void> => {
      if (abortedRef.current) return;
      onEvent?.({ type: "read", message: `Reading ${name}...` });
      let success = false;
      for (let attempt = 0; attempt < maxRetries && !success; attempt++) {
        if (abortedRef.current) return;
        try {
          const result = await protocol.getParameter(name);
          loaded.set(name, result.value);
          success = true;
          onEvent?.({ type: "read", message: `${name} = ${result.value}` });
        } catch {
          if (attempt < maxRetries - 1) {
            const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
      if (!success) {
        failed.push(name);
        onEvent?.({ type: "error", message: `Failed to read ${name} after ${maxRetries} retries` });
      }
    };

    try {
      for (let i = 0; i < paramNames.length; i += batchSize) {
        if (abortedRef.current) return;
        const batch = paramNames.slice(i, i + batchSize);
        await Promise.allSettled(batch.map((name) => fetchOne(name)));
        completedCount = Math.min(i + batchSize, paramNames.length);
        if (abortedRef.current) return;
        setParams(new Map(loaded));
        setLoadProgress({ loaded: completedCount, total: paramNames.length });
      }

      if (abortedRef.current) return;

      originalValues.current = new Map(loaded);
      undoStack.current = [];
      setUndoCount(0);
      setParams(new Map(loaded));
      setDirtyParams(new Set());
      setHasRamWrites(false);
      setLoadProgress(null);

      if (failed.length > 0) {
        const criticalFailed = failed.filter((f) => !optionalSet.has(f));
        const optionalFailed = failed.filter((f) => optionalSet.has(f));
        if (optionalFailed.length > 0) setMissingOptional(new Set(optionalFailed));
        if (criticalFailed.length > 0) {
          setError(`Failed to load: ${criticalFailed.join(", ")}`);
        } else {
          setHasLoaded(true);
        }
      } else {
        setHasLoaded(true);
      }

      markPanelLoaded(panelId);
      cachePanel(panelId, new Map(loaded), new Map(loaded));
      cachePanelToIDB(panelId, loaded).catch(() => {});
      setIdbCacheTimestamp(null);
    } finally {
      if (!abortedRef.current) setLoading(false);
    }
  }, [getProtocol, paramNames, optionalSet, panelId, maxRetries, batchSize, markPanelLoaded, cachePanel, onEvent]);

  const loadParamsRef = useRef(loadParams);
  loadParamsRef.current = loadParams;

  useEffect(() => {
    const cached = getCachedPanel(panelId);
    if (cached) {
      setParams(new Map(cached.params));
      originalValues.current = new Map(cached.originalValues);
      setHasLoaded(true);
      setDirtyParams(new Set());
      setHasRamWrites(false);
      markPanelLoaded(panelId);
    } else {
      const protocol = getProtocol();
      const isDisconnected = !protocol || !protocol.isConnected;
      if (isDisconnected) {
        getCachedPanelFromIDB(panelId).then((idbData) => {
          if (idbData) {
            const paramMap = new Map(Object.entries(idbData.params).map(([k, v]) => [k, v]));
            setParams(paramMap);
            originalValues.current = new Map(paramMap);
            setHasLoaded(true);
            setDirtyParams(new Set());
            setHasRamWrites(false);
            setIdbCacheTimestamp(idbData.timestamp);
          }
        }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    abortedRef.current = false;
    if (autoLoad) loadParamsRef.current();
    return () => { abortedRef.current = true; };
  }, [autoLoad]);

  const setLocalValue = useCallback((name: string, value: number) => {
    setParams((prev) => {
      const previousValue = prev.get(name);
      if (previousValue !== undefined) {
        const stack = undoStack.current;
        stack.push({ name, previousValue });
        if (stack.length > MAX_UNDO_STACK) stack.shift();
        setUndoCount(stack.length);
      }
      const next = new Map(prev);
      next.set(name, value);
      return next;
    });
    setDirtyParams((prev) => { const next = new Set(prev); next.add(name); return next; });
  }, []);

  const saveToRam = useCallback(async (name: string, value: number): Promise<boolean> => {
    const protocol = getProtocol();
    if (!protocol || !protocol.isConnected) {
      onEvent?.({ type: "error", message: `Cannot save ${name}: not connected` });
      return false;
    }
    try {
      const oldValue = originalValues.current.get(name) ?? 0;
      onEvent?.({ type: "write", message: `Saving ${name} = ${value} to RAM...` });
      const result = await protocol.setParameter(name, value);
      if (result.success) {
        trackWrite(name, oldValue, value, panelId);
        const meta = externalMetadata?.get(name);
        if (meta?.rebootRequired) trackRebootParam(name);
        setDirtyParams((prev) => { const next = new Set(prev); next.delete(name); return next; });
        originalValues.current.set(name, value);
        setHasRamWrites(true);
        useDiagnosticsStore.getState().logEvent("param_write", name + " = " + value);
        onEvent?.({ type: "write", message: `Saved ${name} = ${value} to RAM` });
        return true;
      }
      onEvent?.({ type: "error", message: `Failed to save ${name}` });
      return false;
    } catch {
      onEvent?.({ type: "error", message: `Error saving ${name}` });
      return false;
    }
  }, [getProtocol, panelId, trackWrite, trackRebootParam, externalMetadata, onEvent]);

  const saveAllToRam = useCallback(async (): Promise<boolean> => {
    // Armed-write guard. When the vehicle is armed, pop a confirm dialog
    // listing the pending parameter writes. User must explicitly opt in.
    // See `use-armed-lock.ts` and `armed-confirm-store.ts` for the pattern.
    if (dirtyParams.size > 0) {
      const armState = useDroneStore.getState().armState;
      const connectionState = useDroneStore.getState().connectionState;
      const isArmed =
        armState === "armed" && connectionState !== "disconnected";
      if (isArmed) {
        const confirmed = await useArmedConfirmStore
          .getState()
          .requestConfirm({ panelId, paramNames: Array.from(dirtyParams) });
        if (!confirmed) {
          onEvent?.({
            type: "info",
            message: "Save cancelled — vehicle is armed",
          });
          return false;
        }
      }
    }

    let allOk = true;
    for (const name of dirtyParams) {
      const value = params.get(name);
      if (value !== undefined) { const ok = await saveToRam(name, value); if (!ok) allOk = false; }
    }
    return allOk;
  }, [dirtyParams, params, saveToRam, panelId, onEvent]);

  const commitToFlash = useCallback(async (): Promise<boolean> => {
    const protocol = getProtocol();
    if (!protocol || !protocol.isConnected) {
      onEvent?.({ type: "error", message: "Cannot write to flash: not connected" });
      return false;
    }
    try {
      onEvent?.({ type: "flash", message: "Writing to flash..." });
      const result = await protocol.commitParamsToFlash();
      if (result.success) {
        commitFlashStore(true);
        setHasRamWrites(false);
        useDiagnosticsStore.getState().logEvent("flash_commit", "Flash commit");
        onEvent?.({ type: "flash", message: "Written to flash" });
        return true;
      }
      onEvent?.({ type: "error", message: "Failed to write to flash" });
      return false;
    } catch (err) {
      console.error(`[${panelId}] commitParamsToFlash error:`, err);
      onEvent?.({ type: "error", message: "Error writing to flash" });
      return false;
    }
  }, [getProtocol, commitFlashStore, panelId, onEvent]);

  const revert = useCallback((name: string) => {
    const original = originalValues.current.get(name);
    if (original !== undefined) {
      setParams((prev) => { const next = new Map(prev); next.set(name, original); return next; });
      setDirtyParams((prev) => { const next = new Set(prev); next.delete(name); return next; });
    }
  }, []);

  const revertAll = useCallback(() => {
    setParams(new Map(originalValues.current));
    setDirtyParams(new Set());
    undoStack.current = [];
    setUndoCount(0);
  }, []);

  const undo = useCallback(() => {
    const stack = undoStack.current;
    const entry = stack.pop();
    if (!entry) return;
    setUndoCount(stack.length);
    setParams((prev) => { const next = new Map(prev); next.set(entry.name, entry.previousValue); return next; });
    const original = originalValues.current.get(entry.name);
    if (original !== undefined && original === entry.previousValue) {
      setDirtyParams((prev) => { const next = new Set(prev); next.delete(entry.name); return next; });
    }
  }, []);

  const registerActions = useFcPanelActionsStore((s) => s.register);
  const unregisterActions = useFcPanelActionsStore((s) => s.unregister);

  useEffect(() => {
    const wrappedSave = async () => { await saveAllToRam(); };
    const wrappedRefresh = async () => { await loadParams(); };
    registerActions(wrappedSave, wrappedRefresh);
    return () => unregisterActions();
  }, [registerActions, unregisterActions, saveAllToRam, loadParams]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo]);

  return {
    params, loading, error, dirtyParams, hasRamWrites, loadProgress, hasLoaded,
    missingOptional, undoCount, idbCacheTimestamp,
    refresh: loadParams, setLocalValue, saveToRam, saveAllToRam, commitToFlash,
    revert, revertAll, undo,
  };
}
