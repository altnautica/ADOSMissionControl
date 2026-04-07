"use client";

import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { Button } from "@/components/ui/button";

/**
 * Modal confirmation shown when a user tries to save parameters while the
 * vehicle is armed. Promise-based — `useArmedConfirmStore.requestConfirm()`
 * resolves true if the user clicks "Write Anyway", false otherwise.
 *
 * Mounted once at the application shell root. Reads state from the store
 * and renders conditionally.
 */
export function ArmedWriteConfirmDialog() {
  const open = useArmedConfirmStore((s) => s.open);
  const context = useArmedConfirmStore((s) => s.context);
  const confirm = useArmedConfirmStore((s) => s.confirm);
  const cancel = useArmedConfirmStore((s) => s.cancel);

  // Escape key cancels.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, cancel]);

  if (!open || !context) return null;

  const count = context.paramNames.length;
  const preview = context.paramNames.slice(0, 6);
  const overflow = count - preview.length;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={cancel}
    >
      <div
        className="w-full max-w-md mx-4 rounded border border-status-warning/60 bg-bg-primary p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <ShieldAlert size={24} className="text-status-warning shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-text-primary">
              Vehicle is armed
            </h2>
            <p className="mt-1 text-xs text-text-secondary leading-relaxed">
              You are about to write {count} parameter{count === 1 ? "" : "s"}{" "}
              to the flight controller while it is armed. The changes take
              effect immediately and may affect in-flight behavior.
            </p>

            <div className="mt-3 border border-border-default rounded bg-bg-secondary p-2">
              <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">
                Parameters
              </div>
              <div className="flex flex-wrap gap-1.5">
                {preview.map((name) => (
                  <span
                    key={name}
                    className="text-[10px] font-mono text-text-primary bg-bg-primary border border-border-default rounded px-1.5 py-0.5"
                  >
                    {name}
                  </span>
                ))}
                {overflow > 0 && (
                  <span className="text-[10px] font-mono text-text-tertiary px-1.5 py-0.5">
                    +{overflow} more
                  </span>
                )}
              </div>
            </div>

            <p className="mt-3 text-[10px] text-text-tertiary">
              Panel: <span className="font-mono">{context.panelId}</span>
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={confirm}>
            Write Anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
