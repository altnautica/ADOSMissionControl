"use client";

/**
 * @module PairModal
 * @description Pair-with-drone modal. Collects the fleet's radio key (base64)
 * and the drone's device id, installs the key on the ground station, and shows
 * the fleet slot the station issued. A different fleet key already installed
 * offers unpair-and-retry; every other refusal reads as the agent's error code
 * in plain words.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { pairApiFromAgent } from "@/lib/api/ground-station/pair-source";
import { useArmedOverrideConfirm } from "@/hooks/use-armed-override-confirm";

interface PairModalProps {
  open: boolean;
  onClose: () => void;
}

export function PairModal({ open, onClose }: PairModalProps) {
  const t = useTranslations("hardware.pair");
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const pair = useGroundStationStore((s) => s.pair);
  const startPair = useGroundStationStore((s) => s.startPair);
  const unpair = useGroundStationStore((s) => s.unpair);
  const clearPair = useGroundStationStore((s) => s.clearPair);
  const { withArmedOverride, armedOverrideDialog } = useArmedOverrideConfirm();

  const [keyB64, setKeyB64] = useState("");
  const [droneId, setDroneId] = useState("");
  const [sharedKeyB64, setSharedKeyB64] = useState("");
  const [unpairConfirmOpen, setUnpairConfirmOpen] = useState(false);

  // Every close goes through here (the modal's own close and Done), so the
  // form starts empty on the next open; the keys never outlive the dialog.
  const handleClose = () => {
    setKeyB64("");
    setDroneId("");
    setSharedKeyB64("");
    setUnpairConfirmOpen(false);
    clearPair();
    onClose();
  };

  const handleSubmit = async () => {
    const client = pairApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    await startPair(client, keyB64, droneId, sharedKeyB64);
  };

  const handleConfirmUnpair = async () => {
    setUnpairConfirmOpen(false);
    const client = pairApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    try {
      await withArmedOverride((force) => unpair(client, { force }));
    } catch {
      // The operator declined the armed override: the pair stays as it is.
      return;
    }
    await startPair(client, keyB64, droneId, sharedKeyB64);
  };

  const hasClient = Boolean(agentUrl);
  const holdsOtherFleetKey = pair.errorCode === "E_FLEET_KEY_MISMATCH";
  const canSubmit =
    keyB64.trim().length > 0 && droneId.trim().length > 0 && !pair.loading && hasClient;
  // The agent's machine code reads as plain words when the modal knows it;
  // an unknown code falls back to the agent's own message.
  const errorKey = pair.errorCode ? `errors.${pair.errorCode}` : null;
  const errorText = errorKey && t.has(errorKey) ? t(errorKey) : pair.error;

  const footer = pair.result ? (
    <Button variant="primary" onClick={handleClose}>
      {t("done")}
    </Button>
  ) : (
    <>
      <Button variant="secondary" onClick={handleClose} disabled={pair.loading}>
        {t("cancel")}
      </Button>
      {holdsOtherFleetKey ? (
        <Button variant="primary" onClick={() => setUnpairConfirmOpen(true)} loading={pair.loading}>
          {t("unpairAndRetry")}
        </Button>
      ) : (
        <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} loading={pair.loading}>
          {t("submit")}
        </Button>
      )}
    </>
  );

  return (
    <>
    <Modal open={open} onClose={handleClose} title={t("title")} footer={footer} className="max-w-md">
      {pair.result ? (
        <div className="space-y-3" data-testid="pair-success">
          <div className="rounded border border-status-success/40 bg-status-success/10 px-3 py-2 text-sm text-status-success">
            {pair.result.paired_at === null ? t("joinedFleet") : t("success")}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-text-secondary">{t("droneId")}</span>
            <span className="font-mono text-sm text-text-primary break-all">
              {pair.result.paired_with_device_id ?? droneId.trim()}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-text-secondary">{t("fleetSlot")}</span>
            <span className="font-mono text-sm text-text-primary">
              {t("fleetSlotValue", { slot: pair.result.fleet_slot, count: pair.result.slots.length })}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-text-secondary">{t("fingerprint")}</span>
            <span className="font-mono text-xs text-text-primary break-all">
              {pair.result.fingerprint ?? t("unknown")}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-text-secondary">{t("sharedKey")}</span>
            <span className="text-xs text-text-primary">
              {t(`sharedKeyOutcome.${pair.result.shared_key ?? "notSupplied"}`)}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-text-secondary">{t("intro")}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor="pair-fleet-key" className="text-xs text-text-secondary">
              {t("keyLabel")}
            </label>
            <textarea
              id="pair-fleet-key"
              value={keyB64}
              onChange={(e) => setKeyB64(e.target.value)}
              placeholder={t("keyPlaceholder")}
              autoFocus
              rows={3}
              spellCheck={false}
              autoComplete="off"
              className="w-full px-2 py-1 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors resize-none break-all"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pair-drone-id" className="text-xs text-text-secondary">
              {t("droneIdLabel")}
            </label>
            <input
              id="pair-drone-id"
              type="text"
              value={droneId}
              onChange={(e) => setDroneId(e.target.value)}
              placeholder={t("droneIdPlaceholder")}
              spellCheck={false}
              autoComplete="off"
              className="w-full h-8 px-2 bg-bg-tertiary border border-border-default text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pair-shared-key" className="text-xs text-text-secondary">
              {t("sharedKeyLabel")}
            </label>
            <textarea
              id="pair-shared-key"
              value={sharedKeyB64}
              onChange={(e) => setSharedKeyB64(e.target.value)}
              placeholder={t("sharedKeyPlaceholder")}
              rows={2}
              spellCheck={false}
              autoComplete="off"
              className="w-full px-2 py-1 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors resize-none break-all"
            />
          </div>
          {pair.error ? (
            <div
              role="alert"
              className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error"
            >
              {errorText}
            </div>
          ) : null}
          {!hasClient ? (
            <div className="rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
              {t("noClient")}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
    <ConfirmDialog
      open={unpairConfirmOpen}
      title={t("unpairTitle")}
      message={t("unpairMessage")}
      confirmLabel={t("unpair")}
      variant="danger"
      onCancel={() => setUnpairConfirmOpen(false)}
      onConfirm={handleConfirmUnpair}
    />
    {armedOverrideDialog}
    </>
  );
}
