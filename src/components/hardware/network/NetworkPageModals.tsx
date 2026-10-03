"use client";

/**
 * @module NetworkPageModals
 * @description The set of modals/dialogs the network page renders at the
 * bottom of the tree. Pulled out of `page.tsx` so the page reads as a
 * composition of named sections instead of a wall of modals.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { PairModal } from "@/components/hardware/PairModal";
import { WifiScanModal } from "@/components/hardware/WifiScanModal";
import { EthernetConfigModal } from "@/components/hardware/EthernetConfigModal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { EthernetConfig } from "@/lib/api/ground-station/types";
import { ModemConfigModal } from "./ModemConfigModal";

interface Props {
  pairOpen: boolean;
  setPairOpen: (v: boolean) => void;
  scanOpen: boolean;
  setScanOpen: (v: boolean) => void;
  ethernetOpen: boolean;
  setEthernetOpen: (v: boolean) => void;
  ethernetConfig: EthernetConfig | null;
  leaveWifiConfirmOpen: boolean;
  setLeaveWifiConfirmOpen: (v: boolean) => void;
  onConfirmLeaveWifi: () => void;
  shareUplinkConfirmOpen: boolean;
  setShareUplinkConfirmOpen: (v: boolean) => void;
  onConfirmShareUplink: () => void;
  modemOpen: boolean;
  /** The modem's current enabled state, or null when unknown. */
  modemEnabled: boolean | null;
  setModemOpen: (v: boolean) => void;
  apnDraft: string;
  capGbDraft: number;
  modemEnabledDraft: boolean;
  savingModem: boolean;
  setApnDraft: (v: string) => void;
  setCapGbDraft: (v: number) => void;
  setModemEnabledDraft: (v: boolean) => void;
  onApplyModem: () => void;
}

export function NetworkPageModals(p: Props) {
  const t = useTranslations("hardware.connectionRisk");
  return (
    <>
      <PairModal open={p.pairOpen} onClose={() => p.setPairOpen(false)} />
      <WifiScanModal open={p.scanOpen} onClose={() => p.setScanOpen(false)} />
      <EthernetConfigModal
        open={p.ethernetOpen}
        onClose={() => p.setEthernetOpen(false)}
        initial={p.ethernetConfig}
      />

      <ConfirmDialog
        open={p.leaveWifiConfirmOpen}
        title="Leave WiFi network?"
        message="The ground node will fall back to its access-point mode."
        confirmLabel="Leave"
        variant="danger"
        onCancel={() => p.setLeaveWifiConfirmOpen(false)}
        onConfirm={p.onConfirmLeaveWifi}
      />

      <ConfirmDialog
        open={p.shareUplinkConfirmOpen}
        title={t("shareTitle")}
        message={t("shareMessage")}
        confirmLabel={t("shareConfirm")}
        variant="danger"
        onCancel={() => p.setShareUplinkConfirmOpen(false)}
        onConfirm={p.onConfirmShareUplink}
      />

      <ModemConfigModal
        open={p.modemOpen}
        apnDraft={p.apnDraft}
        capGbDraft={p.capGbDraft}
        modemEnabledDraft={p.modemEnabledDraft}
        modemEnabled={p.modemEnabled}
        saving={p.savingModem}
        setApnDraft={p.setApnDraft}
        setCapGbDraft={p.setCapGbDraft}
        setModemEnabledDraft={p.setModemEnabledDraft}
        onClose={() => p.setModemOpen(false)}
        onSave={p.onApplyModem}
      />
    </>
  );
}
