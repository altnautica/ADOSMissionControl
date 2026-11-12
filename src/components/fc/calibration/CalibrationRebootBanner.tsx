"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useDroneStore } from "@/stores/drone-store";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useArmedLock } from "@/hooks/use-armed-lock";

export function CalibrationRebootBanner({
  label,
  onReboot,
}: {
  label: string;
  onReboot: () => void;
}) {
  const tr = useTranslations("fcPanels.calibrationRebootBanner");
  const tDrone = useTranslations("droneDetail");
  const tPanel = useTranslations("dronePanel");
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const [rebootDetected, setRebootDetected] = useState(false);

  // Detect reboot: a heartbeat gap > 2 s, seen when heartbeats resume.
  useEffect(
    () =>
      useDroneStore.subscribe((state, prev) => {
        if (prev.lastHeartbeat === 0 || state.lastHeartbeat === 0) return;
        if (state.lastHeartbeat - prev.lastHeartbeat > 2000) setRebootDetected(true);
      }),
    [],
  );

  // Dismiss after the reboot. This effect depends only on the detection, so
  // the heartbeats that keep arriving afterwards cannot cancel its timers.
  useEffect(() => {
    if (!rebootDetected) return;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setFadingOut(true);
      fadeTimer = setTimeout(() => setDismissed(true), 400);
    }, 3000);
    return () => {
      clearTimeout(timer);
      clearTimeout(fadeTimer);
    };
  }, [rebootDetected]);

  if (dismissed) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 border border-status-warning/30 bg-status-warning/10 px-4 py-3 transition-all"
      style={fadingOut ? { animation: "fade-out-down 0.4s ease-out forwards" } : undefined}
    >
      <div>
        <p className="text-sm font-medium text-status-warning">{tr("rebootRequired")}</p>
        <p className="text-xs text-text-secondary mt-0.5">
          {tr("applyHint", { label })}
        </p>
      </div>
      <Button
        variant="primary"
        size="sm"
        disabled={isHardBlocked}
        title={isHardBlocked ? hardBlockMessage : undefined}
        onClick={() => setConfirming(true)}
      >
        {tDrone("rebootFc")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onReboot();
        }}
        title={tDrone("rebootFc")}
        message={tPanel("rebootConfirm")}
        confirmLabel={tPanel("reboot")}
        variant="danger"
      />
    </div>
  );
}
