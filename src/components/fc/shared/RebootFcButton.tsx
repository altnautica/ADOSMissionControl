"use client";

/**
 * The flight-controller reboot control every FC surface uses.
 *
 * A reboot drops the autopilot, so it is never one click and never sent while
 * the vehicle may be armed (armed, or an open link whose arm state is not
 * known): the button is disabled, the confirmation's Reboot is disabled if the
 * vehicle arms while it is open, and the arm state is read again at the
 * moment of confirming.
 *
 * @license GPL-3.0-only
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useDroneStore } from "@/stores/drone-store";

/** Fresh read of the selected vehicle's arm gate, for the moment of sending. */
export function vehicleMayBeArmed(): boolean {
  const { armState, connectionState } = useDroneStore.getState();
  return connectionState !== "disconnected" && armState !== "disarmed";
}

export interface RebootFcDialogProps {
  open: boolean;
  onCancel: () => void;
  /** Sends the reboot. Called only while the vehicle is known disarmed. */
  onReboot: () => void;
  title?: string;
  message?: string;
  confirmLabel?: string;
  variant?: "primary" | "danger";
}

/** The reboot confirmation on its own, for surfaces that open it themselves. */
export function RebootFcDialog({
  open, onCancel, onReboot, title, message, confirmLabel, variant = "danger",
}: RebootFcDialogProps) {
  const tDrone = useTranslations("droneDetail");
  const tPanel = useTranslations("dronePanel");
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  return (
    <ConfirmDialog
      open={open}
      onCancel={onCancel}
      onConfirm={() => {
        if (vehicleMayBeArmed()) return;
        onReboot();
      }}
      confirmDisabled={isHardBlocked}
      title={title ?? tDrone("rebootFc")}
      message={isHardBlocked ? hardBlockMessage : (message ?? tPanel("rebootConfirm"))}
      confirmLabel={confirmLabel ?? tPanel("reboot")}
      variant={variant}
    />
  );
}

export interface RebootFcButtonProps {
  /** Sends the reboot once the operator confirmed and the vehicle is disarmed. */
  onReboot: () => void | Promise<void>;
  label?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

export function RebootFcButton({
  onReboot, label, variant = "danger", size = "sm", icon, loading, disabled = false, className,
}: RebootFcButtonProps) {
  const tDrone = useTranslations("droneDetail");
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        loading={loading}
        className={className}
        disabled={disabled || isHardBlocked}
        title={isHardBlocked ? hardBlockMessage : undefined}
        onClick={() => setConfirming(true)}
      >
        {label ?? tDrone("rebootFc")}
      </Button>
      <RebootFcDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onReboot={() => {
          setConfirming(false);
          void onReboot();
        }}
      />
    </>
  );
}
