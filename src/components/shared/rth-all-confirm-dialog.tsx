"use client";

/**
 * @module shared/rth-all-confirm-dialog
 * @description The one confirmation every "Return to Home — All Drones" entry
 * point goes through. Recalling the whole fleet is a single press with a large
 * blast radius, so the dashboard button and the command palette share this
 * dialog and its fan-out rather than each deciding how much to ask first.
 * @license GPL-3.0-only
 */

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { describeFleetOutcome, returnFleetToLaunch } from "@/lib/fleet-commands";

interface RthAllConfirmDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RthAllConfirmDialog({ open, onClose }: RthAllConfirmDialogProps) {
  const { toast } = useToast();

  return (
    <ConfirmDialog
      open={open}
      onConfirm={() => {
        onClose();
        void (async () => {
          const outcome = await returnFleetToLaunch();
          const { message, variant } = describeFleetOutcome(outcome, "RTH");
          toast(message, variant);
        })();
      }}
      onCancel={onClose}
      title="Return to Home — All Drones"
      message="This will command ALL active drones to return to their home positions immediately. This action cannot be undone."
      confirmLabel="RTH All"
      variant="danger"
    />
  );
}
