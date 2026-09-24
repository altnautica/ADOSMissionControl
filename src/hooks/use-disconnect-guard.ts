"use client";

import { useState, useCallback } from "react";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import type { CommandResult } from "@/lib/protocol/types";

export function useDisconnectGuard() {
  const { toast } = useToast();
  const [guardOpen, setGuardOpen] = useState(false);
  const [pendingDroneId, setPendingDroneId] = useState<string | null>(null);

  const requestDisconnect = useCallback((droneId: string) => {
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
      toast("The flight controller disconnected before the flash commit; the changes were not saved", "error");
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
      toast(`Flash commit failed: ${result.message}. Still connected; nothing was disconnected.`, "error");
      return;
    }
    if (result.acknowledged === false) {
      toast("Flash commit sent — the vehicle did not acknowledge it", "warning");
    }
    useParamSafetyStore.getState().commitFlash(true);
    useDroneManager.getState().disconnectDrone(droneId);
  }, [pendingDroneId, toast]);

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
  };
}
