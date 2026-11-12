"use client";

/**
 * @module ModemConfigModal
 * @description Modal for editing the 4G modem APN, monthly data cap, and
 * enable flag. Parent owns the form state so cancel just closes the modal.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";

interface Props {
  open: boolean;
  apnDraft: string;
  capGbDraft: number;
  modemEnabledDraft: boolean;
  /** The modem's current enabled state, or null when unknown. */
  modemEnabled: boolean | null;
  saving: boolean;
  setApnDraft: (v: string) => void;
  setCapGbDraft: (v: number) => void;
  setModemEnabledDraft: (v: boolean) => void;
  onClose: () => void;
  onSave: () => void;
}

export function ModemConfigModal({
  open,
  apnDraft,
  capGbDraft,
  modemEnabledDraft,
  modemEnabled,
  saving,
  setApnDraft,
  setCapGbDraft,
  setModemEnabledDraft,
  onClose,
  onSave,
}: Props) {
  const tk = useTranslations("hardware.modemConfigModal");
  const t = useTranslations("hardware.connectionRisk");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Turning the modem off can cut the only uplink: confirm before saving.
  const disabling = !modemEnabledDraft && modemEnabled !== false;
  const save = () => (disabling ? setConfirmOpen(true) : onSave());
  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={tk("configure4GModem")}
      className="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {tk("cancel")}
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {tk("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="APN"
          value={apnDraft}
          onChange={(e) => setApnDraft(e.target.value)}
          placeholder={tk("internet")}
          spellCheck={false}
          autoComplete="off"
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="modem-cap" className="text-xs text-text-secondary">
            Monthly data cap: {capGbDraft} GB
          </label>
          <input
            id="modem-cap"
            type="range"
            min={1}
            max={20}
            step={1}
            value={capGbDraft}
            onChange={(e) => setCapGbDraft(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-[10px] text-text-tertiary">
            <span>1 GB</span>
            <span>20 GB</span>
          </div>
        </div>

        <Toggle
          label={tk("modemEnabled")}
          checked={modemEnabledDraft}
          onChange={setModemEnabledDraft}
        />
      </div>
    </Modal>
    <ConfirmDialog
      open={confirmOpen}
      variant="danger"
      title={t("modemDisableTitle")}
      message={t("modemDisableMessage")}
      confirmLabel={t("modemDisableConfirm")}
      onCancel={() => setConfirmOpen(false)}
      onConfirm={() => {
        setConfirmOpen(false);
        onSave();
      }}
    />
    </>
  );
}
