"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "./modal";
import { Button } from "./button";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  confirmDisabled?: boolean;
  /**
   * Optional typed-phrase gate. When provided, the confirm button stays
   * disabled until the user types this exact phrase into the prompt input.
   * Used for destructive actions like factory reset where a plain click
   * would be too easy to fire by accident.
   */
  typedPhrase?: string;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "primary",
  confirmDisabled = false,
  typedPhrase,
}: ConfirmDialogProps) {
  const t = useTranslations("common");
  const [typed, setTyped] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const phraseRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const phraseGate = typedPhrase ? typed !== typedPhrase : false;
  const finalDisabled = confirmDisabled || phraseGate;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      className="max-w-lg"
      // A destructive confirmation is an alert, not an ordinary dialog, and
      // opening it with focus on the confirm button means one stray Enter
      // commits the action. Pin focus to Cancel instead, or to the phrase
      // input when the dialog asks for one. The input is pinned explicitly
      // rather than left to autoFocus: an effect re-run moves focus back to the
      // trigger, and the modal then falls back to its first focusable control.
      role={variant === "danger" ? "alertdialog" : "dialog"}
      initialFocusRef={typedPhrase ? phraseRef : cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
            {cancelLabel ?? t("cancel")}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={finalDisabled}
          >
            {confirmLabel ?? t("save")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">{message}</p>
      {typedPhrase ? (
        <div className="mt-3 flex flex-col gap-1">
          <label htmlFor="confirm-typed-phrase" className="text-xs text-text-secondary">
            {/* Was hardcoded English on a destructive gate (factory reset and
                friends), so a non-English operator saw the one instruction
                that unlocks the action in a language they may not read. */}
            {t.rich("confirmTypePhrase", {
              phrase: () => <span className="font-mono text-text-primary">{typedPhrase}</span>,
            })}
          </label>
          <input
            ref={phraseRef}
            id="confirm-typed-phrase"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="w-full h-9 px-2 bg-bg-tertiary border border-border-default text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary focus-ring transition-colors"
          />
        </div>
      ) : null}
    </Modal>
  );
}
