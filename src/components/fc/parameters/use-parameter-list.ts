/**
 * Loads the selected drone's full parameter list for the raw Parameters grid:
 * served from the per-drone cache when it still describes the current link,
 * otherwise downloaded in one streamed pass with live progress.
 *
 * A download that is superseded (the operator re-read, switched drones or the
 * link reconnected) is dropped: it neither reaches the cache nor the grid.
 *
 * @module fc/parameters/use-parameter-list
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import {
  beginParamDownload,
  commitParamDownload,
  getCachedParamList,
  updateCachedParamList,
} from "@/stores/param-list-cache";
import { loadParamMetadata, type ParamMetadata } from "@/lib/protocol/param-metadata";
import type { ParameterValue } from "@/lib/protocol/types";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export interface ParameterListState {
  parameters: ParameterValue[];
  metadata: Map<string, ParamMetadata>;
  loading: boolean;
  progress: { current: number; total: number };
  error: string | null;
  setError: (error: string | null) => void;
  /** Re-read every parameter from the FC. */
  downloadParams: () => Promise<void>;
  /** Apply values the FC acknowledged to the grid and the cache. */
  applyWritten: (values: Map<string, number>) => void;
}

/**
 * @param onReset called whenever the list is replaced by another drone's or a
 *   fresh download, so staged edits never carry over onto different values.
 */
export function useParameterList(onReset: () => void): ParameterListState {
  const t = useTranslations("parameters");
  const [parameters, setParameters] = useState<ParameterValue[]>([]);
  const [metadata, setMetadata] = useState<Map<string, ParamMetadata>>(new Map());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const selectedProtocol = useDroneManager((s) => {
    const id = s.selectedDroneId;
    return id ? s.drones.get(id)?.protocol ?? null : null;
  });
  const onResetRef = useRef(onReset);
  const tRef = useRef(t);
  useEffect(() => {
    onResetRef.current = onReset;
    tRef.current = t;
  });
  // The generation of the download this panel is waiting for; any other
  // completion is stale.
  const activeGeneration = useRef(0);
  const lastProgressUpdate = useRef(0);

  const downloadParams = useCallback(async () => {
    const manager = useDroneManager.getState();
    const droneId = manager.selectedDroneId;
    const protocol = manager.getSelectedProtocol();
    if (!droneId || !protocol) { setError(tRef.current("noDroneConnected")); return; }
    const generation = beginParamDownload(droneId);
    activeGeneration.current = generation;
    setLoading(true); setError(null); setProgress({ current: 0, total: 0 });
    onResetRef.current();
    // Keyed by param index, not a raw per-frame counter: a lossy link makes
    // the GCS re-request missing indices and the FC itself may retransmit,
    // so the same index can legitimately arrive more than once during one
    // download. Overwriting by index mirrors the adapter's own dedup so the
    // displayed count can never exceed reality.
    const receivedByIndex = new Map<number, ParameterValue>();
    // A stray or malformed frame can report an index outside its own count;
    // a real indexed parameter always satisfies 0 <= index < count.
    const unsub = protocol.onParameter((param) => {
      if (activeGeneration.current !== generation) return;
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
      const current = commitParamDownload(droneId, protocol, generation, params);
      if (current && activeGeneration.current === generation) setParameters(params);
    } catch (err) {
      if (activeGeneration.current === generation) {
        setError(err instanceof Error ? err.message : tRef.current("downloadFailed"));
      }
    } finally {
      unsub();
      if (activeGeneration.current === generation) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Whatever was on screen belonged to the previous selection or link.
    activeGeneration.current = 0;
    setLoading(false);
    const cached = selectedDroneId && selectedProtocol
      ? getCachedParamList(selectedDroneId, selectedProtocol)
      : null;
    if (cached) {
      setParameters(cached);
      onResetRef.current();
    } else {
      setParameters([]);
      void downloadParams();
    }
    const drone = useDroneManager.getState().getSelectedDrone();
    if (drone?.vehicleInfo) {
      loadParamMetadata({
        firmwareType: drone.vehicleInfo.firmwareType,
        vehicleClass: drone.vehicleInfo.vehicleClass,
        firmwareVersion: drone.vehicleInfo.firmwareVersionString,
        protocol: drone.protocol,
      }).then(setMetadata);
    }
  }, [selectedDroneId, selectedProtocol, downloadParams]);

  const applyWritten = useCallback((values: Map<string, number>) => {
    const manager = useDroneManager.getState();
    const droneId = manager.selectedDroneId;
    const protocol = manager.getSelectedProtocol();
    setParameters((prev) => {
      const updated = prev.map((p) => {
        const nv = values.get(p.name);
        return nv !== undefined ? { ...p, value: nv } : p;
      });
      if (droneId && protocol) updateCachedParamList(droneId, protocol, updated);
      return updated;
    });
  }, []);

  return { parameters, metadata, loading, progress, error, setError, downloadParams, applyWritten };
}
