import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { usePanelCacheStore } from "@/stores/panel-cache-store";
import { useFcPanelActionsStore } from "@/stores/fc-panel-actions-store";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { confirmArmedParamWrite, writeParamToFc } from "@/lib/protocol/param-write";
import { cachePanelToIDB, getCachedPanelFromIDB } from "@/lib/param-cache-idb";
import type { PanelParamOptions, PanelParamState, PanelParamActions, UndoEntry } from "./use-panel-params-types";
import type { FlashCommitOutcome } from "./use-flash-commit-toast";
import { MAX_UNDO_STACK, RETRY_DELAYS, DEFAULT_BATCH_SIZE, EMPTY_ARRAY } from "./use-panel-params-types";

export type { PanelParamOptions, PanelParamState, PanelParamActions, PanelParamEvent } from "./use-panel-params-types";

export function usePanelParams(
  options: PanelParamOptions,
): PanelParamState & PanelParamActions {
  const { paramNames, optionalParams = EMPTY_ARRAY, panelId, autoLoad = false, maxRetries = 3, batchSize = DEFAULT_BATCH_SIZE, onEvent, metadata: externalMetadata } = options;
  const optionalSet = useMemo(() => new Set(optionalParams), [optionalParams]);
  // Every name the panel renders is read: required names first, then any
  // optional-only name. `optionalParams` only decides whether a failed read
  // blocks the panel, never whether the read happens.
  const loadNames = useMemo(() => {
    const required = new Set(paramNames);
    return [...paramNames, ...optionalParams.filter((n) => !required.has(n))];
  }, [paramNames, optionalParams]);

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
  // Bumped by every load, by a param-set change and by a drone switch. A load
  // that settles after a newer one started (or after the drone changed) must
  // not write its values, originals or cache entry: they describe what the
  // panel asked of another drone or another parameter set.
  const loadGenRef = useRef(0);

  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const commitFlashStore = useParamSafetyStore((s) => s.commitFlash);
  const markPanelLoaded = useParamSafetyStore((s) => s.markPanelLoaded);
  const cachePanel = usePanelCacheStore((s) => s.cachePanel);
  const getCachedPanel = usePanelCacheStore((s) => s.getCachedPanel);

  const loadParams = useCallback(async () => {
    const gen = ++loadGenRef.current;
    const stale = () => gen !== loadGenRef.current;
    const protocol = getProtocol();
    if (!protocol || !protocol.isConnected) {
      const msg = "Not connected to flight controller";
      setError(msg);
      onEvent?.({ type: "error", message: msg });
      return;
    }

    setLoading(true);
    setError(null);
    setLoadProgress({ loaded: 0, total: loadNames.length });
    onEvent?.({ type: "info", message: `Loading ${loadNames.length} parameters...` });

    const loaded = new Map<string, number>();
    const failed: string[] = [];
    let completedCount = 0;

    const fetchOne = async (name: string): Promise<void> => {
      if (stale()) return;
      onEvent?.({ type: "read", message: `Reading ${name}...` });
      let success = false;
      for (let attempt = 0; attempt < maxRetries && !success; attempt++) {
        if (stale()) return;
        try {
          const result = await protocol.getParameter(name);
          loaded.set(name, result.value);
          success = true;
          onEvent?.({ type: "read", message: `${name} = ${result.value}` });
        } catch (err) {
          // A param this board does not have will never answer. Once the full
          // param list has been downloaded the protocol knows this and rejects
          // immediately with code "param_absent" — don't burn the retry budget
          // (5s × N) on it and don't record it as a failed read. It is simply
          // absent: left out of both `loaded` and `failed`, so it neither
          // blocks the panel nor shows as an error.
          if ((err as { code?: string } | null)?.code === "param_absent") {
            onEvent?.({ type: "read", message: `${name} not present on this board` });
            return;
          }
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
      for (let i = 0; i < loadNames.length; i += batchSize) {
        if (stale()) return;
        const batch = loadNames.slice(i, i + batchSize);
        await Promise.allSettled(batch.map((name) => fetchOne(name)));
        completedCount = Math.min(i + batchSize, loadNames.length);
        if (stale()) return;
        setParams(new Map(loaded));
        setLoadProgress({ loaded: completedCount, total: loadNames.length });
      }

      if (stale()) return;

      originalValues.current = new Map(loaded);
      undoStack.current = [];
      setUndoCount(0);
      setParams(new Map(loaded));
      setDirtyParams(new Set());
      setHasRamWrites(false);
      setLoadProgress(null);

      setMissingOptional(new Set(failed.filter((f) => optionalSet.has(f))));
      if (failed.length > 0) {
        const criticalFailed = failed.filter((f) => !optionalSet.has(f));
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
      if (selectedDroneId) {
        cachePanelToIDB(selectedDroneId, panelId, loaded).catch(() => {});
      }
      setIdbCacheTimestamp(null);
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [getProtocol, selectedDroneId, loadNames, optionalSet, panelId, maxRetries, batchSize, markPanelLoaded, cachePanel, onEvent]);

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
      if (isDisconnected && selectedDroneId) {
        const gen = loadGenRef.current;
        getCachedPanelFromIDB(selectedDroneId, panelId).then((idbData) => {
          // A load or a drone switch since then owns the panel now.
          if (idbData && gen === loadGenRef.current) {
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

  // Auto-load on mount AND whenever the requested parameter set changes.
  //
  // `paramNames` used to be absent from this dep array while `loadParams`
  // itself depends on it, so switching the Copter/Plane/Rover tab or opening
  // the Filters group swapped the param set with NO reload: every
  // newly-requested gain rendered as a live slider at 0, and one drag marked it
  // dirty so Save overwrote the tuned value on the vehicle. Same failure in
  // `StreamRatesPanel` on channel switch, where 0 disables a telemetry group.
  //
  // The dep is the set's CONTENT, not the array identity: a caller that builds
  // `paramNames` inline would otherwise reload on every render and hammer the
  // flight controller with PARAM_REQUEST_READ.
  const paramSetKey = loadNames.join("\u0000");
  useEffect(() => {
    if (autoLoad) loadParamsRef.current();
    return () => { loadGenRef.current += 1; };
  }, [autoLoad, paramSetKey]);

  // Belt and braces for per-drone isolation.
  //
  // `NodeDetailPanel` keys its surfaces on the node id, so a drone switch
  // normally remounts this hook. This reset covers every OTHER mount site —
  // a panel hosted outside that panel, a surface that memoises across the
  // key — because the consequence is not cosmetic: `saveToRam` resolves
  // `getProtocol()` live, so a carried-over dirty edit writes drone A's
  // numbers into drone B.
  const seenDroneRef = useRef(selectedDroneId);
  useEffect(() => {
    if (seenDroneRef.current === selectedDroneId) return;
    seenDroneRef.current = selectedDroneId;
    // Whatever the previous drone's load was still fetching is now stale.
    loadGenRef.current += 1;
    setParams(new Map());
    originalValues.current = new Map();
    setDirtyParams(new Set());
    setHasRamWrites(false);
    setHasLoaded(false);
    setLoading(false);
    setLoadProgress(null);
    setMissingOptional(new Set());
    setError(null);
    undoStack.current = [];
    setUndoCount(0);
    setIdbCacheTimestamp(null);
    if (autoLoad) loadParamsRef.current();
  }, [selectedDroneId, autoLoad]);

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
      onEvent?.({ type: "write", message: `Saving ${name} = ${value} to RAM...` });
      const result = await writeParamToFc({
        writer: protocol,
        name,
        value,
        oldValue: originalValues.current.get(name) ?? 0,
        panelId,
        rebootRequired: externalMetadata?.get(name)?.rebootRequired,
      });
      if (result.success) {
        setDirtyParams((prev) => { const next = new Set(prev); next.delete(name); return next; });
        originalValues.current.set(name, value);
        setHasRamWrites(true);
        onEvent?.({ type: "write", message: `Saved ${name} = ${value} to RAM` });
        return true;
      }
      onEvent?.({ type: "error", message: `Failed to save ${name}` });
      return false;
    } catch {
      onEvent?.({ type: "error", message: `Error saving ${name}` });
      return false;
    }
  }, [getProtocol, panelId, externalMetadata, onEvent]);

  const saveAllToRam = useCallback(async (): Promise<boolean> => {
    // Armed-write guard, shared with the raw Parameters grid so both surfaces
    // ask the same question in the same words.
    const confirmed = await confirmArmedParamWrite(
      panelId,
      Array.from(dirtyParams),
    );
    if (!confirmed) {
      onEvent?.({
        type: "info",
        message: "Save cancelled — vehicle is armed",
      });
      return false;
    }

    let allOk = true;
    for (const name of dirtyParams) {
      const value = params.get(name);
      if (value !== undefined) { const ok = await saveToRam(name, value); if (!ok) allOk = false; }
    }
    return allOk;
  }, [dirtyParams, params, saveToRam, panelId, onEvent]);

  const commitToFlash = useCallback(async (): Promise<FlashCommitOutcome> => {
    const protocol = getProtocol();
    if (!protocol || !protocol.isConnected) {
      onEvent?.({ type: "error", message: "Cannot write to flash: not connected" });
      return { sent: false, acknowledged: false };
    }
    try {
      onEvent?.({ type: "flash", message: "Sending flash commit..." });
      const result = await protocol.commitParamsToFlash();
      if (result.success) {
        // The command is deliberately fire-and-forget, so a `success` here
        // means "reached the wire", not "the vehicle stored it". Saying
        // "written to flash" for an unacknowledged write trains an operator to
        // trust a claim nothing verified; the distinction is carried out to the
        // caller rather than collapsed into a boolean here.
        const acknowledged = result.acknowledged !== false;
        commitFlashStore(true);
        setHasRamWrites(false);
        useDiagnosticsStore.getState().logEvent("flash_commit", "Flash commit");
        onEvent?.({
          type: "flash",
          message: acknowledged
            ? "Written to flash"
            : "Flash commit sent (unacknowledged)",
        });
        return { sent: true, acknowledged };
      }
      onEvent?.({ type: "error", message: "Failed to send flash commit" });
      return { sent: false, acknowledged: false };
    } catch (err) {
      console.error(`[${panelId}] commitParamsToFlash error:`, err);
      onEvent?.({ type: "error", message: "Error sending flash commit" });
      return { sent: false, acknowledged: false };
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
    const wrappedSave = async () => {
      // Snapshot the count before the write: `saveAllToRam` resolves `true`
      // for an empty dirty set, so the shortcut layer needs the count to tell
      // "saved" from "there was nothing to save".
      const attempted = dirtyParams.size;
      const ok = await saveAllToRam();
      return { attempted, ok };
    };
    const wrappedRefresh = async () => { await loadParams(); };
    registerActions(wrappedSave, wrappedRefresh);
    return () => unregisterActions(wrappedSave);
  }, [registerActions, unregisterActions, saveAllToRam, loadParams, dirtyParams]);

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
