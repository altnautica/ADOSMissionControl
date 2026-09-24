"use client";

/**
 * @module use-dronecan-node-params
 * @description Per-node parameter editor hook for DroneCAN.
 *
 * Walks the remote node's parameter index via `paramGet(nodeId, i)` starting
 * at i = 0, advancing until the response carries an empty name (the DroneCAN
 * convention for "no parameter at this index"). Each entry holds the current
 * value, optional default / min / max, and a per-row dirty flag.
 *
 * `setLocal` mutates the local cache only; `saveAllDirty` flushes every
 * dirty row through `paramSet`. `eraseToDefaults` issues
 * `paramExecuteOpcode(ERASE)` and `restartNode` issues a `RestartNode`
 * service request. Callers are expected to follow either with a `refresh()`
 * once the node is back online.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ValueTag, type Value as ParamValueRaw } from "@/lib/dronecan/dsdl/param-getset";
import {
  OPCODE_ERASE,
  OPCODE_SAVE,
} from "@/lib/dronecan/dsdl/param-executeopcode";
import type { DroneCanClient as RealDroneCanClient } from "@/lib/dronecan/client";

/** Tagged value shape matching `uavcan.protocol.param.Value`. */
export type ParamValue = ParamValueRaw;

export interface ParamEntry {
  name: string;
  value: ParamValue;
  defaultValue?: ParamValue;
  min?: ParamValue;
  max?: ParamValue;
  dirty: boolean;
}

/**
 * Subset of the DroneCAN client surface this hook depends on. Structurally
 * a subset of the real `DroneCanClient`, so callers can pass the real client
 * directly. Method return shapes mirror the live DSDL response types.
 */
export interface DroneCanClient {
  paramGet: RealDroneCanClient["paramGet"];
  paramSet: RealDroneCanClient["paramSet"];
  paramExecuteOpcode: RealDroneCanClient["paramExecuteOpcode"];
  restart: RealDroneCanClient["restart"];
}

export const PARAM_OPCODE_SAVE = OPCODE_SAVE;
export const PARAM_OPCODE_ERASE = OPCODE_ERASE;

/**
 * `true` when the param-getset response carries no `Empty`-tagged value (the
 * DroneCAN convention for "no parameter at this index").
 */
function isNonEmptyValue(v: ParamValue): boolean {
  return v.tag !== ValueTag.Empty;
}

const MAX_INDEX_WALK = 1024;

export interface UseDroneCanNodeParamsResult {
  params: Map<string, ParamEntry>;
  loading: boolean;
  error: string | null;
  dirty: Set<string>;
  refresh: () => Promise<void>;
  setLocal: (name: string, value: ParamValue) => void;
  saveAllDirty: () => Promise<{ saved: number; failed: number }>;
  eraseToDefaults: () => Promise<{ ok: boolean }>;
  restartNode: () => Promise<{ ok: boolean }>;
}

export function useDroneCanNodeParams(
  client: DroneCanClient | null,
  nodeId: number,
): UseDroneCanNodeParamsResult {
  const [params, setParams] = useState<Map<string, ParamEntry>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  // Bumped on unmount and whenever the node or client changes. Work started
  // under an older session belongs to a node this editor no longer shows: a
  // walk stops and its result is dropped, and a save stops writing.
  const sessionRef = useRef(0);

  useEffect(() => () => {
    sessionRef.current += 1;
  }, []);

  // One node's parameters and dirty edits never carry over to another node,
  // or a Save would write them there.
  const seenRef = useRef({ client, nodeId });
  useEffect(() => {
    if (seenRef.current.client === client && seenRef.current.nodeId === nodeId) return;
    seenRef.current = { client, nodeId };
    sessionRef.current += 1;
    setParams(new Map());
    setDirty(new Set());
    setError(null);
    setLoading(false);
  }, [client, nodeId]);

  const refresh = useCallback(async () => {
    if (!client) return;
    const session = sessionRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = new Map<string, ParamEntry>();
      for (let i = 0; i < MAX_INDEX_WALK; i++) {
        const res = await client.paramGet(nodeId, i);
        if (session !== sessionRef.current) return;
        if (!res.name || res.name.length === 0) break;
        next.set(res.name, {
          name: res.name,
          value: res.value,
          defaultValue: isNonEmptyValue(res.default_value)
            ? res.default_value
            : undefined,
          min: isNonEmptyValue(res.min_value) ? res.min_value : undefined,
          max: isNonEmptyValue(res.max_value) ? res.max_value : undefined,
          dirty: false,
        });
      }
      setParams(next);
      setDirty(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (session === sessionRef.current) setError(msg);
    } finally {
      if (session === sessionRef.current) setLoading(false);
    }
  }, [client, nodeId]);

  const setLocal = useCallback((name: string, value: ParamValue) => {
    setParams((prev) => {
      const entry = prev.get(name);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(name, { ...entry, value, dirty: true });
      return next;
    });
    setDirty((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  const saveAllDirty = useCallback(async () => {
    if (!client) return { saved: 0, failed: 0 };
    const session = sessionRef.current;
    let saved = 0;
    let failed = 0;
    const cleared: string[] = [];
    for (const name of dirty) {
      if (session !== sessionRef.current) break;
      const entry = params.get(name);
      if (!entry) continue;
      try {
        const res = await client.paramSet(nodeId, name, entry.value);
        // The DroneCAN convention: a successful paramSet echoes the new
        // value back. A node that rejects the write echoes the prior value
        // or an Empty-tagged value. Treat name-match + non-empty as success.
        if (res.name === name && isNonEmptyValue(res.value)) {
          cleared.push(name);
          saved++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    if (session === sessionRef.current && cleared.length > 0) {
      setParams((prev) => {
        const next = new Map(prev);
        for (const name of cleared) {
          const entry = next.get(name);
          if (entry) next.set(name, { ...entry, dirty: false });
        }
        return next;
      });
      setDirty((prev) => {
        const next = new Set(prev);
        for (const name of cleared) next.delete(name);
        return next;
      });
    }
    return { saved, failed };
  }, [client, nodeId, dirty, params]);

  const eraseToDefaults = useCallback(async () => {
    if (!client) return { ok: false };
    const res = await client.paramExecuteOpcode(nodeId, PARAM_OPCODE_ERASE);
    return { ok: res.ok };
  }, [client, nodeId]);

  const restartNode = useCallback(async () => {
    if (!client) return { ok: false };
    const res = await client.restart(nodeId);
    return { ok: res.ok };
  }, [client, nodeId]);

  return {
    params,
    loading,
    error,
    dirty,
    refresh,
    setLocal,
    saveAllDirty,
    eraseToDefaults,
    restartNode,
  };
}
