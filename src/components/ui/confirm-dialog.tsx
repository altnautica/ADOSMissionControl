"use client";

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
  variant?: "primary" | "danger";
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel,
  variant = "primary",
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const t = useTranslations("common");
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant={variant === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel ?? t("save")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">{message}</p>
    </Modal>
  );
}
