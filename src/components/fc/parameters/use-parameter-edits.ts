/**
 * Staged edits and every write the raw Parameters grid makes: the batch write
 * of staged values, the factory reset and the reboot a reboot-required write
 * asks for. Owns the downloaded list through {@link useParameterList}, so a
 * fresh list always clears the staged edits made against the old one.
 *
 * @module fc/parameters/use-parameter-edits
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { confirmArmedParamWrite, describeParamBatch, writeParamBatch } from "@/lib/protocol/param-write";
import type { ParameterValue } from "@/lib/protocol/types";
import { exportParamFile } from "./param-file-io";
import { useParameterList, type ParameterListState } from "./use-parameter-list";

/**
 * Panel id every write from this surface is attributed to, in the armed-confirm
 * dialog and the pending-write records. The FC panels use their own ids.
 */
const PANEL_ID = "parameters";

export interface ParameterEditsState extends Omit<ParameterListState, "applyWritten"> {
  /** Staged values by parameter name, not yet on the vehicle. */
  modified: Map<string, number>;
  /** Values the vehicle holds, without staged edits. */
  fcParamMap: Map<string, number>;
  saving: boolean;
  writeProgress: { current: number; total: number };
  /** The staged batch as old/new pairs, for the write confirmation. */
  writeChanges: { name: string; oldValue: number; newValue: number }[];
  showRebootPrompt: boolean;
  setShowRebootPrompt: (show: boolean) => void;
  stage: (name: string, value: number) => void;
  revert: () => void;
  /** Write every staged value; what landed leaves the staged set. */
  writeStaged: () => Promise<void>;
  resetToDefaults: () => Promise<void>;
  reboot: () => Promise<void>;
  exportMissionPlanner: () => void;
  exportQgc: () => void;
}

export function useParameterEdits(): ParameterEditsState {
  const t = useTranslations("parameters");
  const { toast } = useToast();
  const [modified, setModified] = useState<Map<string, number>>(new Map());
  const resetModified = useCallback(() => setModified(new Map()), []);
  const { applyWritten, ...list } = useParameterList(resetModified);
  const { parameters, metadata, setError, downloadParams } = list;
  const [saving, setSaving] = useState(false);
  const [writeProgress, setWriteProgress] = useState({ current: 0, total: 0 });
  const [showRebootPrompt, setShowRebootPrompt] = useState(false);

  // Pre-built Map for O(1) lookups instead of O(n) .find() calls
  const paramsByName = useMemo(() => {
    const map = new Map<string, ParameterValue>();
    for (const p of parameters) map.set(p.name, p);
    return map;
  }, [parameters]);

  // The compare view diffs a file against what the vehicle holds, so staged
  // (unwritten) grid edits stay out of its "FC Value" column.
  const fcParamMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of parameters) map.set(p.name, p.value);
    return map;
  }, [parameters]);

  const stage = useCallback((name: string, value: number) => {
    setModified((prev) => {
      const original = paramsByName.get(name);
      if (original && original.value === value) { const next = new Map(prev); next.delete(name); return next; }
      return new Map(prev).set(name, value);
    });
  }, [paramsByName]);

  const writeStaged = useCallback(async () => {
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
      const landed = new Map<string, number>();
      for (const name of written) {
        const nv = modified.get(name);
        if (nv !== undefined) landed.set(name, nv);
      }
      applyWritten(landed);
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
  }, [modified, paramsByName, metadata, toast, applyWritten, setError]);

  const writeChanges = useMemo(() => Array.from(modified.entries()).map(([name, newValue]) => ({
    name, oldValue: paramsByName.get(name)?.value ?? 0, newValue,
  })), [modified, paramsByName]);

  /** The reboot the "parameters need a restart" prompt offers. The FC can
   * refuse the command (wrong mode, armed, unsupported); closing the dialog on
   * a refusal reads as a reboot that happened, so report the refusal. */
  const reboot = useCallback(async () => {
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

  const resetToDefaults = useCallback(async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) { setError(t("noDroneConnected")); return; }
    setSaving(true); setError(null);
    try {
      const result = await protocol.resetParametersToDefault();
      if (result.success) {
        // Give the FC a moment to apply the reset before re-reading it.
        const settled = Promise.withResolvers<void>();
        setTimeout(settled.resolve, 1000);
        await settled.promise;
        await downloadParams();
        setShowRebootPrompt(true);
      } else {
        setError(`Reset failed: ${result.message}`);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Reset command failed"); }
    finally { setSaving(false); }
  }, [downloadParams, setError, t]);

  const exportMissionPlanner = useCallback(() => {
    exportParamFile(parameters, modified, { format: "mp" });
  }, [parameters, modified]);

  const exportQgc = useCallback(() => {
    const vi = useDroneManager.getState().getSelectedDrone()?.vehicleInfo;
    exportParamFile(parameters, modified, {
      format: "qgc",
      systemId: vi?.systemId ?? 1,
      componentId: vi?.componentId ?? 1,
    });
  }, [parameters, modified]);

  return {
    ...list,
    modified, fcParamMap, saving, writeProgress, writeChanges,
    showRebootPrompt, setShowRebootPrompt,
    stage, revert: resetModified, writeStaged, resetToDefaults, reboot,
    exportMissionPlanner, exportQgc,
  };
}
