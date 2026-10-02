"use client";

/**
 * Reviewed parameter restore: a diff of a parameter set (a .param file or the
 * backup taken before a flash) against what the flight controller holds now.
 * Unchanged and read-only entries are skipped, the operator picks what to
 * write, and nothing is written while the vehicle is armed.
 *
 * @module fc/firmware/ParamRestoreDialog
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useArmedLock } from "@/hooks/use-armed-lock";
import type { DroneProtocol } from "@/lib/protocol/types";
import { compareParams, type ParamDiff, type ParsedParam } from "@/lib/formats/param-file-parser";
import { describeParamBatch, writeParamBatch } from "@/lib/protocol/param-write";
import { isReadOnly } from "@/components/fc/parameters/parameter-grid-utils";

/** Pending-write records from this surface are attributed to the firmware panel. */
const PANEL_ID = "firmware";

interface ParamRestoreDialogProps {
  open: boolean;
  /** Where the values come from, e.g. a file name or "backup from <time>". */
  sourceLabel: string;
  /** The vehicle being written, named in the title. */
  targetLabel: string;
  entries: readonly ParsedParam[];
  protocol: DroneProtocol | null;
  onClose: () => void;
  /** Called once at least one parameter landed. */
  onApplied?: () => void;
}

export function ParamRestoreDialog({
  open, sourceLabel, targetLabel, entries, protocol, onClose, onApplied,
}: ParamRestoreDialogProps) {
  const { toast } = useToast();
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const [diffs, setDiffs] = useState<ParamDiff[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [writing, setWriting] = useState(false);

  // Diff against a fresh read of the vehicle each time the dialog opens.
  useEffect(() => {
    if (!open || !protocol) return;
    let cancelled = false;
    setDiffs(null);
    setLoadError(null);
    protocol.getAllParameters()
      .then((fcParams) => {
        if (cancelled) return;
        const fc = new Map(fcParams.map((p) => [p.name, p.value]));
        const rows = compareParams([...entries], fc)
          .filter((d) => d.status !== "unchanged" && !isReadOnly(d.name, undefined));
        setDiffs(rows);
        setSelected(new Set(rows.filter((d) => d.status === "changed").map((d) => d.name)));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [open, protocol, entries]);

  const toggle = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const chosen = useMemo(() => (diffs ?? []).filter((d) => selected.has(d.name)), [diffs, selected]);

  const apply = useCallback(async () => {
    if (!protocol || chosen.length === 0 || isHardBlocked) return;
    setWriting(true);
    try {
      const outcome = await writeParamBatch(
        protocol,
        chosen.map((d) => ({ name: d.name, value: d.fileValue, oldValue: d.fcValue ?? 0 })),
        PANEL_ID,
      );
      const summary = describeParamBatch(outcome);
      toast(summary.message, summary.level);
      if (outcome.written.size > 0) onApplied?.();
      onClose();
    } finally {
      setWriting(false);
    }
  }, [protocol, chosen, isHardBlocked, toast, onApplied, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Restore parameters to ${targetLabel}`}
      role="alertdialog"
      size="md"
      closeBlocked={writing}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={writing}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => void apply()}
            disabled={!protocol || chosen.length === 0 || isHardBlocked || writing}
            loading={writing}
          >
            {`Write ${chosen.length} parameter${chosen.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <p className="text-text-secondary">
          Values from {sourceLabel} that differ from what {targetLabel} holds now. Unchanged and read-only parameters are skipped.
        </p>
        {isHardBlocked && <p className="text-status-error" role="alert">{hardBlockMessage}</p>}
        {!protocol && <p className="text-status-warning">Connect the flight controller to compare and restore.</p>}
        {loadError && <p className="text-status-error" role="alert">Could not read the current parameters: {loadError}</p>}
        {protocol && !diffs && !loadError && <p className="text-text-tertiary">Reading current parameters…</p>}
        {diffs && diffs.length === 0 && <p className="text-text-tertiary">Nothing to restore: every value already matches.</p>}
        {diffs && diffs.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto border border-border-default">
            <table className="w-full font-mono">
              <thead className="bg-bg-tertiary text-text-tertiary text-[10px] uppercase">
                <tr>
                  <th className="w-6" />
                  <th className="text-left px-2 py-1">Name</th>
                  <th className="text-right px-2 py-1">Now</th>
                  <th className="text-right px-2 py-1">Restore</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((d) => (
                  <tr key={d.name} className="border-t border-border-default">
                    <td className="px-1 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(d.name)}
                        onChange={() => toggle(d.name)}
                        aria-label={`Restore ${d.name}`}
                      />
                    </td>
                    <td className="px-2 py-1 text-text-primary">{d.name}</td>
                    <td className="px-2 py-1 text-right text-text-tertiary">{d.fcValue ?? "not on vehicle"}</td>
                    <td className="px-2 py-1 text-right text-text-primary">{d.fileValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
