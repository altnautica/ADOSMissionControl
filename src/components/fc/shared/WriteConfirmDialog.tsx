"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, X, ShieldAlert } from "lucide-react";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import { decodeBitmaskFlags, summarizeBitmask } from "@/lib/protocol/param-display";
import { isCriticalParam } from "@/lib/protocol/critical-params";

function isValueOutOfRange(value: number, meta: ParamMetadata | undefined): boolean {
  if (!meta?.range) return false;
  return value < meta.range.min || value > meta.range.max;
}

function enumLabel(value: number, meta: ParamMetadata | undefined): string | undefined {
  if (!meta?.values) return undefined;
  return meta.values.get(value) ?? meta.values.get(Math.trunc(value));
}

/** Documented flag labels added/removed between two bitmask values. */
function bitmaskDiff(oldV: number, newV: number, bitmask: Map<number, string>) {
  const before = new Set(decodeBitmaskFlags(oldV, bitmask).set);
  const after = decodeBitmaskFlags(newV, bitmask).set;
  const afterSet = new Set(after);
  return {
    added: after.filter((l) => !before.has(l)),
    removed: [...before].filter((l) => !afterSet.has(l)),
  };
}

interface WriteConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  changes: { name: string; oldValue: number; newValue: number }[];
  metadata?: Map<string, ParamMetadata>;
}

export function WriteConfirmDialog({ open, onCancel, onConfirm, changes, metadata }: WriteConfirmDialogProps) {
  const hasCritical = useMemo(
    () => changes.some((c) => isCriticalParam(c.name)),
    [changes]
  );
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);

  // Reset checkbox when dialog opens/closes
  const handleCancel = () => {
    setSafetyAcknowledged(false);
    onCancel();
  };

  const handleConfirm = () => {
    setSafetyAcknowledged(false);
    onConfirm();
  };

  return (
    <Modal open={open} onClose={handleCancel} title="Confirm Parameter Write" className="max-w-lg">
      <div className="flex flex-col gap-4">
        {/* Critical safety banner */}
        {hasCritical && (
          <div className="flex items-center gap-2 px-3 py-2 bg-status-error/10 border border-status-error/30 text-status-error text-xs">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span>
              This batch includes flight-safety parameters. Review carefully before writing.
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 text-status-warning">
          <AlertTriangle size={16} />
          <span className="text-sm">
            {changes.length} parameter{changes.length !== 1 ? "s" : ""} will be written to the flight controller.
          </span>
        </div>

        <div className="max-h-[300px] overflow-y-auto border border-border-default">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-secondary">
              <tr className="border-b border-border-default">
                <th className="px-3 py-2 text-left font-semibold text-text-secondary">Parameter</th>
                <th className="px-3 py-2 text-right font-semibold text-text-secondary">Old</th>
                <th className="px-3 py-2 text-right font-semibold text-text-secondary">New</th>
              </tr>
            </thead>
            <tbody>
              {changes.map(({ name, oldValue, newValue }) => {
                const critical = isCriticalParam(name);
                const meta = metadata?.get(name);
                const outOfRange = isValueOutOfRange(newValue, meta);

                return (
                  <tr key={name} className="border-b border-border-default">
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-text-primary">{name}</span>
                        {critical && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-status-error/15 text-status-error rounded-sm">
                            <AlertTriangle size={10} />
                            Flight safety
                          </span>
                        )}
                      </div>
                      {outOfRange && meta?.range && (
                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-status-warning">
                          <AlertTriangle size={9} />
                          Outside expected range ({meta.range.min} .. {meta.range.max})
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right align-top">
                      <div className="font-mono text-text-tertiary">{oldValue}</div>
                      {enumLabel(oldValue, meta) && (
                        <div className="text-[10px] text-text-tertiary">{enumLabel(oldValue, meta)}</div>
                      )}
                      {meta?.bitmask?.size ? (
                        <div className="text-[10px] text-text-tertiary">{summarizeBitmask(oldValue, meta.bitmask)}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-right align-top">
                      <div className="font-mono text-status-warning">{newValue}</div>
                      {enumLabel(newValue, meta) && (
                        <div className="text-[10px] text-text-secondary">{enumLabel(newValue, meta)}</div>
                      )}
                      {meta?.bitmask?.size ? (() => {
                        const { added, removed } = bitmaskDiff(oldValue, newValue, meta.bitmask);
                        return (
                          <div className="text-[10px] flex flex-col items-end">
                            {added.map((l) => <span key={`a${l}`} className="text-status-success">+ {l}</span>)}
                            {removed.map((l) => <span key={`r${l}`} className="text-status-error">− {l}</span>)}
                          </div>
                        );
                      })() : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Safety acknowledgment checkbox for critical params */}
        {hasCritical && (
          <label className="flex items-start gap-2.5 px-3 py-2.5 bg-status-error/5 border border-status-error/20 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={safetyAcknowledged}
              onChange={(e) => setSafetyAcknowledged(e.target.checked)}
              className="mt-0.5 accent-status-error"
            />
            <span className="flex items-center gap-1.5 text-xs text-status-error">
              <ShieldAlert size={13} className="flex-shrink-0" />
              I understand this change affects flight safety
            </span>
          </label>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" icon={<X size={12} />} onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Check size={12} />}
            onClick={handleConfirm}
            disabled={hasCritical && !safetyAcknowledged}
          >
            Write {changes.length} Parameter{changes.length !== 1 ? "s" : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
