"use client";

import { useMemo, useRef } from "react";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

/**
 * Destructive confirmation shown when disconnecting with parameter writes that
 * are in RAM but not committed to flash. One of its three actions discards
 * those writes outright.
 *
 * It was a bare `fixed inset-0` overlay with none of the modal affordances: no
 * Escape handling, no `role`, no `aria-modal`, no accessible name, no focus
 * trap, no focus restore, no backdrop dismissal and no close control. Assistive
 * tech got no modal announcement, and keyboard focus stayed on the page behind
 * the overlay — so a keyboard user could tab into the controls they had just
 * been warned about instead of the ones in the dialog. It now renders through
 * the shared `Modal` as an `alertdialog` with initial focus pinned to Cancel,
 * the least destructive of the three actions.
 */
interface DisconnectGuardProps {
  open: boolean;
  onCommitAndDisconnect: () => void;
  onDiscardAndDisconnect: () => void;
  onCancel: () => void;
}

export function DisconnectGuard({
  open,
  onCommitAndDisconnect,
  onDiscardAndDisconnect,
  onCancel,
}: DisconnectGuardProps) {
  const pendingWrites = useParamSafetyStore((s) => s.pendingWrites);
  const hasCritical = useParamSafetyStore((s) => s.hasCriticalPending());
  const isCriticalParam = useParamSafetyStore((s) => s.isCriticalParam);
  const pendingCount = pendingWrites.size;

  const entries = useMemo(
    () => Array.from(pendingWrites.values()),
    [pendingWrites],
  );

  // Cancel keeps the connection and the pending writes, so it is the safe
  // landing spot for focus when the dialog opens.
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (!open || pendingCount === 0) return null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      // Hardcoded English title: no locale key exists for it, so the literal
      // is passed through unchanged rather than pointing at an invented key.
      title="Uncommitted Parameter Changes"
      role="alertdialog"
      initialFocusRef={cancelRef}
      size="sm"
      // Discarding flight-controller parameter writes should not be reachable
      // by a stray click on the backdrop; Escape still cancels, which is the
      // non-destructive outcome.
      disableBackdropClose
      footer={
        <>
          <Button variant="primary" size="sm" onClick={onCommitAndDisconnect}>
            Commit to Flash & Disconnect
          </Button>
          <Button variant="danger" size="sm" onClick={onDiscardAndDisconnect}>
            Discard & Disconnect
          </Button>
          <Button ref={cancelRef} variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={20}
            className="text-status-warning shrink-0"
            aria-hidden="true"
          />
          <p className="text-xs text-text-secondary">
            {pendingCount} parameter{pendingCount !== 1 ? "s have" : " has"} been written to RAM but not committed to flash.
            Disconnecting now will lose these changes on next reboot.
          </p>
        </div>

        {/* Pending writes table */}
        <div className="max-h-[200px] overflow-y-auto border border-border-default">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-bg-secondary">
              <tr className="border-b border-border-default">
                <th className="px-2 py-1 text-left font-semibold text-text-secondary">Parameter</th>
                <th className="px-2 py-1 text-right font-semibold text-text-secondary">Old</th>
                <th className="px-2 py-1 text-center text-text-tertiary">{"\u2192"}</th>
                <th className="px-2 py-1 text-right font-semibold text-text-secondary">New</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const critical = isCriticalParam(entry.paramName);
                return (
                  <tr
                    key={entry.paramName}
                    className={cn(
                      "border-b border-border-default",
                      critical && "bg-status-error/5",
                    )}
                  >
                    <td className={cn(
                      "px-2 py-1 font-mono",
                      critical ? "text-status-error font-medium" : "text-text-primary",
                    )}>
                      {entry.paramName}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-text-tertiary">
                      {entry.oldValue}
                    </td>
                    <td className="px-2 py-1 text-center text-text-tertiary">{"\u2192"}</td>
                    <td className="px-2 py-1 text-right font-mono text-text-primary">
                      {entry.newValue}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {hasCritical && (
          <div className="p-2 bg-status-error/10 border border-status-error/20">
            <p className="text-[10px] text-status-error font-medium">
              Includes safety-critical parameters (failsafe, battery, motor, arming).
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
