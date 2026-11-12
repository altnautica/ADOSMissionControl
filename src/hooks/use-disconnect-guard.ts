"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useNodeRegistryStore } from "@/stores/node-registry/node-registry-store";
import { useToast } from "@/components/ui/toast";
import type { CommandResult } from "@/lib/protocol/types";

/** Whether a managed drone is positively known to be armed: the selected
 * drone's live arm state, else that node's registry entry. */
function isDroneArmed(droneId: string): boolean {
  if (useDroneManager.getState().selectedDroneId === droneId) {
    return useDroneStore.getState().armState === "armed";
  }
  return useNodeRegistryStore.getState().getEntry(droneId)?.fc.armState === "armed";
}

export function useDisconnectGuard() {
  const { toast } = useToast();
  const t = useTranslations("panelCommit.disconnectGuard");
  const [guardOpen, setGuardOpen] = useState(false);
  const [pendingDroneId, setPendingDroneId] = useState<string | null>(null);
  // An armed drone the operator asked to disconnect, awaiting confirmation.
  const [armedDrone, setArmedDrone] = useState<{ id: string; name: string } | null>(null);

  // Past the armed check: stop for pending parameter writes, else disconnect.
  const disconnectUnlessWritesPending = useCallback((droneId: string) => {
    const pendingCount = useParamSafetyStore.getState().getPendingCount();
    if (pendingCount > 0) {
      setPendingDroneId(droneId);
      setGuardOpen(true);
    } else {
      // No pending writes, disconnect immediately. disconnectDrone marks the
      // drone intentional BEFORE it closes the protocol, so the transport's
      // close is never mistaken for a dropped link and re-dialled.
      useDroneManager.getState().disconnectDrone(droneId);
    }
  }, []);

  const requestDisconnect = useCallback(
    (droneId: string) => {
      // Cutting the link of an armed aircraft asks first.
      if (isDroneArmed(droneId)) {
        const name = useDroneManager.getState().drones.get(droneId)?.name ?? droneId;
        setArmedDrone({ id: droneId, name });
        return;
      }
      disconnectUnlessWritesPending(droneId);
    },
    [disconnectUnlessWritesPending],
  );

  const confirmArmedDisconnect = useCallback(() => {
    if (!armedDrone) return;
    setArmedDrone(null);
    disconnectUnlessWritesPending(armedDrone.id);
  }, [armedDrone, disconnectUnlessWritesPending]);

  const cancelArmedDisconnect = useCallback(() => setArmedDrone(null), []);

  const commitAndDisconnect = useCallback(async () => {
    if (!pendingDroneId) return;
    const droneId = pendingDroneId;
    setPendingDroneId(null);
    setGuardOpen(false);
    const drone = useDroneManager.getState().drones.get(droneId);
    if (!drone) {
      // The link is already gone, so nothing was committed: the writes stay
      // in the FC's RAM and are lost on its next reboot.
      useParamSafetyStore.getState().commitFlash(false);
      toast(t("lostBeforeCommit"), "error");
      return;
    }
    // The commit rides the link, so the link stays up until the flight
    // controller has answered it (or refused).
    let result: CommandResult;
    try {
      result = await drone.protocol.commitParamsToFlash();
    } catch (err) {
      result = { success: false, resultCode: -1, message: err instanceof Error ? err.message : String(err) };
    }
    if (!result.success) {
      // Disconnecting now would drop RAM-only changes the operator asked to
      // keep. Stay connected with the writes still pending so they can retry.
      toast(t("commitFailedStillConnected", { message: result.message ?? "" }), "error");
      return;
    }
    if (result.acknowledged === false) {
      toast(t("flashUnacknowledged"), "warning");
    }
    useParamSafetyStore.getState().commitFlash(true);
    useDroneManager.getState().disconnectDrone(droneId);
  }, [pendingDroneId, toast, t]);

  const discardAndDisconnect = useCallback(() => {
    if (!pendingDroneId) return;
    useParamSafetyStore.getState().clear();
    useDroneManager.getState().disconnectDrone(pendingDroneId);
    setPendingDroneId(null);
    setGuardOpen(false);
  }, [pendingDroneId]);

  const cancelDisconnect = useCallback(() => {
    setPendingDroneId(null);
    setGuardOpen(false);
  }, []);

  return {
    guardOpen,
    commitAndDisconnect,
    discardAndDisconnect,
    cancelDisconnect,
    requestDisconnect,
    armedDrone,
    confirmArmedDisconnect,
    cancelArmedDisconnect,
  };
}
