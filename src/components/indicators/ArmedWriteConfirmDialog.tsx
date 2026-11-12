"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * Modal confirmation shown when a user tries to save parameters while the
 * vehicle is armed. Promise-based — `useArmedConfirmStore.requestConfirm()`
 * resolves true if the user clicks "Write Anyway", false otherwise.
 *
 * Mounted once at the application shell root. Reads state from the store
 * and renders conditionally.
 *
 * The hand-rolled overlay handled Escape and backdrop clicks but carried no
 * `role`, no `aria-modal` and no accessible name — its `<h2>` was referenced
 * by nothing — and it had neither a focus trap nor focus restore. It now
 * renders through the shared `Modal` as an `alertdialog`, because it interrupts
 * to confirm a parameter write to an armed vehicle, and pins initial focus to
 * Cancel so a stray Enter on an already-focused page control cannot commit the
 * write.
 */
export function ArmedWriteConfirmDialog() {
  const tk = useTranslations("indicators.armedWriteConfirmDialog");
  const open = useArmedConfirmStore((s) => s.open);
  const context = useArmedConfirmStore((s) => s.context);
  const confirm = useArmedConfirmStore((s) => s.confirm);
  const cancel = useArmedConfirmStore((s) => s.cancel);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations("armedWriteConfirm");

  if (!open || !context) return null;

  const count = context.paramNames.length;
  const preview = context.paramNames.slice(0, 6);
  const overflow = count - preview.length;

  return (
    <Modal
      open={open}
      onClose={cancel}
      title={context.armStateUnknown ? t("titleUnknown") : t("title")}
      role="alertdialog"
      initialFocusRef={cancelRef}
      size="sm"
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" size="sm" onClick={cancel}>
            {tk("cancel")}
          </Button>
          <Button variant="danger" size="sm" onClick={confirm}>
            {tk("writeAnyway")}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <ShieldAlert
          size={24}
          className="text-status-warning shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="flex-1">
          <p className="text-xs text-text-secondary leading-relaxed">
            {context.armStateUnknown ? t("bodyUnknown", { count }) : t("body", { count })}
          </p>

          <div className="mt-3 border border-border-default rounded bg-bg-secondary p-2">
            <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">
              {tk("parameters")}
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
            {tk("panel")} <span className="font-mono">{context.panelId}</span>
          </p>
        </div>
      </div>
    </Modal>
  );
}
