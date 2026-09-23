"use client";

/**
 * Settings-panel lifecycle hook : the name-based-settings sibling of
 * `usePanelParams`.
 *
 * FC panels that read/write iNav name-based settings (or a dedicated iNav MSP2
 * config block) get the same lifecycle as numeric-parameter panels — loading,
 * error, has-loaded, dirty tracking, read retry, armed-write confirmation, and
 * an unsaved-changes guard — while going through the `DroneProtocol` contract
 * (never a concrete adapter cast). The panel supplies typed `read`/`write`
 * callbacks that operate on the protocol; the hook owns the lifecycle.
 *
 * @module hooks/use-settings-params
 */

import { useCallback, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { RETRY_DELAYS } from "@/hooks/use-panel-params-types";
import type { DroneProtocol } from "@/lib/protocol/types";

export interface SettingsPanelOptions<T> {
  /** Stable panel id, used as the armed-confirm dialog context. */
  panelId: string;
  /** Values shown before the first successful read. */
  initial: T;
  /** Read the current values from the FC through the `DroneProtocol` contract. */
  read: (protocol: DroneProtocol) => Promise<T>;
  /** Write the current values to the FC through the `DroneProtocol` contract. */
  write: (protocol: DroneProtocol, values: T) => Promise<void>;
  /** Whether the connected firmware exposes the capability this panel needs. */
  supported: (protocol: DroneProtocol) => boolean;
  /** Error shown when the firmware lacks the capability. */
  unsupportedMessage: string;
  /** Read attempts per `read()` call (default 3). */
  maxRetries?: number;
}

export interface SettingsPanelResult<T> {
  /** Current (possibly edited) values. */
  values: T;
  /** Replace values (or map from the previous) and mark the panel dirty. */
  setValues: (next: T | ((prev: T) => T)) => void;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  dirty: boolean;
  /** Whether a protocol is currently selected. */
  connected: boolean;
  isArmed: boolean;
  lockMessage: string;
  /** Read values from the FC, retrying transient failures. */
  read: () => Promise<void>;
  /** Write the current values to the FC and save them to EEPROM (armed-write confirm gated). */
  write: () => Promise<void>;
}

/**
 * Manage the read/edit/write lifecycle for a settings-backed FC panel.
 *
 * The `read`/`write`/`supported` callbacks should be stable references
 * (module-level functions or `useCallback`) so the returned `read`/`write`
 * stay stable across renders.
 */
export function useSettingsParams<T>(options: SettingsPanelOptions<T>): SettingsPanelResult<T> {
  const {
    panelId,
    initial,
    read: readFn,
    write: writeFn,
    supported,
    unsupportedMessage,
    maxRetries = 3,
  } = options;

  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const connected = !!getSelectedProtocol();

  const [values, setValuesState] = useState<T>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { isArmed, lockMessage } = useArmedLock();
  useUnsavedGuard(dirty);

  const setValues = useCallback((next: T | ((prev: T) => T)) => {
    setValuesState((prev) => (typeof next === "function" ? (next as (p: T) => T)(prev) : next));
    setDirty(true);
  }, []);

  const read = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) { setError("Not connected to flight controller"); return; }
    if (!supported(protocol)) { setError(unsupportedMessage); return; }

    setLoading(true);
    setError(null);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await readFn(protocol);
        setValuesState(result);
        setHasLoaded(true);
        setDirty(false);
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries - 1) {
          const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    setError(lastErr instanceof Error ? lastErr.message : String(lastErr));
    setLoading(false);
  }, [getSelectedProtocol, supported, unsupportedMessage, readFn, maxRetries]);

  const write = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) { setError("Not connected to flight controller"); return; }
    if (!supported(protocol)) { setError(unsupportedMessage); return; }

    // Armed-write guard : identical flow to usePanelParams.saveAllToRam. The
    // Write button is also disabled while armed, so this is belt-and-suspenders.
    const armState = useDroneStore.getState().armState;
    const connectionState = useDroneStore.getState().connectionState;
    if (armState === "armed" && connectionState !== "disconnected") {
      const confirmed = await useArmedConfirmStore
        .getState()
        .requestConfirm({ panelId, paramNames: [] });
      if (!confirmed) return;
    }

    setLoading(true);
    setError(null);
    try {
      await writeFn(protocol, values);
      // Named-setting and MSP2 config writes only change the FC's RAM; the
      // EEPROM write is what makes them survive a power cycle, so the panel
      // stays dirty until it succeeds.
      const saved = await protocol.commitParamsToFlash();
      if (!saved.success) {
        setError(`Written to the flight controller's RAM but not saved: ${saved.message}`);
        return;
      }
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol, supported, unsupportedMessage, writeFn, values, panelId]);

  return {
    values, setValues, loading, error, hasLoaded, dirty,
    connected, isArmed, lockMessage, read, write,
  };
}
