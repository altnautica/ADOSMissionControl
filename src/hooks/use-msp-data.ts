"use client";

/**
 * Hook for panels that need direct MSP reads/writes (not fitting the
 * virtual-param model). Provides load/save/dirty lifecycle.
 *
 * @license GPL-3.0-only
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import type { DroneProtocol } from "@/lib/protocol/types";
import { formatErrorMessage } from "@/lib/utils";

interface MspDataOptions<T> {
  /** Unique panel ID for tracking */
  panelId: string;
  /** Read function — called with protocol to fetch data. Return decoded data. */
  read: (protocol: DroneProtocol) => Promise<T>;
  /** Write function — called with protocol and data to save. */
  write?: (protocol: DroneProtocol, data: T) => Promise<boolean>;
  /** Auto-load on mount (default: false) */
  autoLoad?: boolean;
}

interface MspDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  /** Reload data from FC */
  refresh: () => Promise<void>;
  /** Update local data (marks as dirty) */
  setData: (data: T) => void;
  /** Write data to FC */
  save: () => Promise<boolean>;
  /** Write data to FC and commit to EEPROM */
  saveAndFlash: () => Promise<boolean>;
  /** Whether local data differs from loaded data */
  isDirty: boolean;
}

export function useMspData<T>(options: MspDataOptions<T>): MspDataResult<T> {
  const { read, write, autoLoad = false } = options;

  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);

  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Keep a ref to the last-loaded snapshot for dirty comparison
  const loadedRef = useRef<T | null>(null);

  const refresh = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) {
      setError("No drone connected");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await read(protocol);
      setDataState(result);
      loadedRef.current = result;
      setHasLoaded(true);
      setIsDirty(false);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol, read]);

  const setData = useCallback((newData: T) => {
    setDataState(newData);
    setIsDirty(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!write) return false;
    if (data === null) return false;

    const protocol = getSelectedProtocol();
    if (!protocol) {
      setError("No drone connected");
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const ok = await write(protocol, data);
      if (ok) {
        loadedRef.current = data;
        setIsDirty(false);
      }
      return ok;
    } catch (err) {
      setError(formatErrorMessage(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [write, data, getSelectedProtocol]);

  const saveAndFlash = useCallback(async (): Promise<boolean> => {
    const ok = await save();
    if (!ok) return false;

    const protocol = getSelectedProtocol();
    if (protocol) {
      // Fire-and-forget (DEC-047)
      protocol.commitParamsToFlash();
    }
    return true;
  }, [save, getSelectedProtocol]);

  // Auto-load on mount if requested
  useEffect(() => {
    if (autoLoad) {
      refresh();
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    data,
    loading,
    error,
    hasLoaded,
    refresh,
    setData,
    save,
    saveAndFlash,
    isDirty,
  };
}
