/**
 * @module UnsavedChangesDialog
 * @description Dialog shown when switching plans with unsaved changes.
 * Three options: Save & Switch, Discard & Switch, Cancel.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

interface UnsavedChangesDialogProps {
  open: boolean;
  onSaveAndSwitch: () => void;
  onDiscardAndSwitch: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({
  open,
  onSaveAndSwitch,
  onDiscardAndSwitch,
  onCancel,
}: UnsavedChangesDialogProps) {
  const t = useTranslations("common");

  return (
    <Modal open={open} onClose={onCancel} title={t("unsavedChangesDialog.title")} className="max-w-sm">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-secondary">
          {t("unsavedChangesDialog.message")}
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="md" className="w-full" onClick={onSaveAndSwitch}>
            {t("unsavedChangesDialog.saveAndSwitch")}
          </Button>
          <Button variant="secondary" size="md" className="w-full" onClick={onDiscardAndSwitch}>
            {t("unsavedChangesDialog.discardAndSwitch")}
          </Button>
          <Button variant="ghost" size="md" className="w-full" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
