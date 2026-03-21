"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { PreFlightChecklist } from "@/components/flight/PreFlightChecklist";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";

interface ActionDialogsProps {
  showRthConfirm: boolean;
  setShowRthConfirm: (v: boolean) => void;
  showAbortConfirm: boolean;
  setShowAbortConfirm: (v: boolean) => void;
  showKillConfirm: boolean;
  setShowKillConfirm: (v: boolean) => void;
  showChecklist: boolean;
  setShowChecklist: (v: boolean) => void;
}

export function ActionDialogs({
  showRthConfirm, setShowRthConfirm,
  showAbortConfirm, setShowAbortConfirm,
  showKillConfirm, setShowKillConfirm,
  showChecklist, setShowChecklist,
}: ActionDialogsProps) {
  const t = useTranslations("actionDialogs");
  const setFlightMode = useDroneStore((s) => s.setFlightMode);
  const setArmState = useDroneStore((s) => s.setArmState);
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const protocol = getProtocol();

  const [showKillFinal, setShowKillFinal] = useState(false);
  const [killCountdown, setKillCountdown] = useState(3);

  useEffect(() => {
    if (!showKillFinal) {
      setKillCountdown(3);
      return;
    }
    if (killCountdown <= 0) return;
    const timer = setTimeout(() => setKillCountdown(killCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [showKillFinal, killCountdown]);

  return (
    <>
      <ConfirmDialog
        open={showRthConfirm}
        onCancel={() => setShowRthConfirm(false)}
        onConfirm={() => {
          if (protocol) protocol.returnToLaunch();
          else setFlightMode("RTL");
          setShowRthConfirm(false);
        }}
        title={t("rthTitle")}
        message={t("rthMessage")}
        confirmLabel={t("rthConfirm")}
        variant="primary"
      />

      <ConfirmDialog
        open={showAbortConfirm}
        onCancel={() => setShowAbortConfirm(false)}
        onConfirm={() => {
          if (protocol) {
            protocol.land();
            protocol.disarm();
          } else {
            setFlightMode("LAND");
            setArmState("disarmed");
          }
          setShowAbortConfirm(false);
        }}
        title={t("abortTitle")}
        message={t("abortMessage")}
        confirmLabel={t("abortConfirm")}
        variant="danger"
      />

      <ConfirmDialog
        open={showKillConfirm}
        onCancel={() => setShowKillConfirm(false)}
        onConfirm={() => {
          setShowKillConfirm(false);
          setShowKillFinal(true);
        }}
        title={t("killTitle")}
        message={t("killMessage")}
        confirmLabel={t("killConfirm")}
        variant="danger"
      />

      <ConfirmDialog
        open={showKillFinal}
        onCancel={() => {
          setShowKillFinal(false);
          setKillCountdown(3);
        }}
        onConfirm={() => {
          if (protocol) protocol.killSwitch();
          setShowKillFinal(false);
          setKillCountdown(3);
        }}
        title={t("killFinalTitle")}
        message={`${t("killFinalMessage")} ${killCountdown > 0 ? t("killFinalWait", { seconds: killCountdown }) : t("killFinalEnabled")}`}
        confirmLabel={killCountdown > 0 ? t("killFinalWait", { seconds: killCountdown }) : t("killFinalConfirm")}
        variant="danger"
        confirmDisabled={killCountdown > 0}
      />

      <Modal
        open={showChecklist}
        onClose={() => setShowChecklist(false)}
        title={t("checklistTitle")}
        className="max-w-md max-h-[80vh] flex flex-col"
      >
        <PreFlightChecklist className="max-h-[60vh] -mx-4 -my-4" />
      </Modal>
    </>
  );
}
