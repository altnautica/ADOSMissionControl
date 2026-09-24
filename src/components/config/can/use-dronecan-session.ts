/**
 * @module config/can/use-dronecan-session
 * @description The CAN configuration page's DroneCAN session. Opening one asks
 * the selected flight controller to forward a CAN bus, so it happens only on an
 * explicit request; the session closes (turning forwarding off) when the
 * operator closes it, selects another drone, or leaves the page.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { formatErrorMessage } from "@/lib/utils";
import { openForwardedDroneCanSession, type DroneCanSession } from "@/lib/dronecan/session";

export type DroneCanSessionState =
  | { status: "closed"; error: string | null }
  | { status: "opening"; bus: number }
  | { status: "open"; bus: number; session: DroneCanSession };

export function useDroneCanSession() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const [state, setState] = useState<DroneCanSessionState>({ status: "closed", error: null });
  const live = useRef<DroneCanSession | null>(null);

  const close = useCallback(async () => {
    const session = live.current;
    live.current = null;
    setState({ status: "closed", error: null });
    if (session) await session.close().catch(() => {});
  }, []);

  const open = useCallback(async (bus: number) => {
    const protocol = selectedProtocol;
    if (!protocol) return;
    await close();
    setState({ status: "opening", bus });
    try {
      const session = await openForwardedDroneCanSession(protocol, bus);
      live.current = session;
      setState({ status: "open", bus, session });
    } catch (err) {
      setState({ status: "closed", error: formatErrorMessage(err) });
    }
  }, [selectedProtocol, close]);

  // A session belongs to the drone it was opened on.
  useEffect(() => {
    void close();
  }, [selectedDroneId, close]);

  // Leaving the page turns forwarding off.
  useEffect(() => () => {
    const session = live.current;
    live.current = null;
    if (session) void session.close().catch(() => {});
  }, []);

  return { state, open, close };
}
