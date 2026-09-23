"use client";

/**
 * @module node-detail/NodeHeaderActions
 * @description The right side of the node-detail header: the node id, the
 * Remove action, the link pills, the HUD link and Reboot FC, with their
 * confirmation dialogs.
 *
 * Remove reports the node removed only once the forget has finished, and a
 * cloud pairing that could not be deleted keeps the node (the forget hook
 * reports why). Reboot always shows the FC's answer: a reboot the FC refuses
 * (armed, busy, unsupported) must not read as one that happened.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MonitorPlay, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { useForgetNode } from "@/hooks/use-forget-node";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useDroneManager } from "@/stores/drone-manager";
import { usePairingStore } from "@/stores/pairing-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { ConnectionQualityMeter } from "@/components/indicators/ConnectionQualityMeter";
import { NavStatePill } from "@/components/indicators/NavStatePill";
import { RuntimeModeBadge } from "@/components/indicators/RuntimeModeBadge";
import { TrafficPill } from "@/components/indicators/TrafficPill";

export function NodeHeaderActions({
  droneId,
  displayName,
  isConnected,
  isDroneProfile,
  onClose,
}: {
  droneId: string;
  displayName: string;
  /** Whether the GCS holds a managed FC session for this node. */
  isConnected: boolean;
  isDroneProfile: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("dronePanel");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const forget = useForgetNode();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rebootOpen, setRebootOpen] = useState(false);

  const handleReboot = async () => {
    setRebootOpen(false);
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) {
      toast("No flight controller connected", "error");
      return;
    }
    try {
      const result = await protocol.reboot();
      toast(
        result.message || (result.success ? "Reboot command sent" : "The FC refused the reboot command"),
        result.success ? "success" : "error",
      );
    } catch {
      toast("Reboot command failed", "error");
    }
  };

  // One atomic forget across every source (Convex cloud row first, then the
  // agent connection, managed FC, LAN credential and registry presence), so a
  // removed node cannot re-feed from the reactive cloud query. `convexId` is
  // the cloud doc id when the node is cloud-paired.
  const handleDelete = async () => {
    setDeleteOpen(false);
    const convexId =
      usePairingStore
        .getState()
        .pairedDrones.find((d) => nodeIdForDevice(d.deviceId) === droneId)?._id ?? null;
    const result = await forget(droneId, { convexId });
    if (!result.ok) return;
    toast(t("nodeRemoved", { name: displayName }), "warning");
    onClose();
  };

  return (
    <>
      <span className="text-[10px] font-mono text-text-tertiary ml-auto shrink-0">
        ID: {droneId}
      </span>
      <Button
        variant="ghost"
        size="sm"
        icon={<Trash2 size={12} />}
        onClick={() => setDeleteOpen(true)}
        className="text-status-error hover:text-status-error shrink-0"
        title={tRoot("linkUp.cta.removeNode")}
      >
        {t("delete")}
      </Button>
      <RuntimeModeBadge />
      {isConnected && <NavStatePill />}
      {isConnected && <TrafficPill />}
      {isConnected && <ConnectionQualityMeter />}
      {isConnected && isDroneProfile && (
        // `/hud` is the chromeless HDMI kiosk surface. It opens in a new tab
        // deliberately: the route strips all GCS chrome, so navigating in
        // place would leave the operator with no way back.
        <a
          href="/hud"
          target="_blank"
          rel="noopener noreferrer"
          title={t("openHud")}
          aria-label={t("openHud")}
          className="flex h-7 shrink-0 items-center gap-1 px-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary focus-ring"
        >
          <MonitorPlay size={12} aria-hidden="true" />
        </a>
      )}
      {isConnected && (
        <Button
          variant="danger"
          size="sm"
          icon={<RotateCcw size={12} />}
          disabled={isHardBlocked}
          title={hardBlockMessage || undefined}
          onClick={() => setRebootOpen(true)}
        >
          {t("rebootFc")}
        </Button>
      )}
      <ConfirmDialog
        open={deleteOpen}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
        title={t("deleteDrone")}
        message={t("deleteConfirm", { name: displayName })}
        confirmLabel={t("delete")}
        variant="danger"
      />
      <ConfirmDialog
        open={rebootOpen}
        onConfirm={() => void handleReboot()}
        onCancel={() => setRebootOpen(false)}
        title={t("rebootFc")}
        message={t("rebootConfirm")}
        confirmLabel={t("reboot")}
        variant="danger"
        confirmDisabled={isHardBlocked}
      />
    </>
  );
}
