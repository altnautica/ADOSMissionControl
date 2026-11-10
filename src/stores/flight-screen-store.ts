/**
 * @module stores/flight-screen-store
 * @description How many flight screens (cockpits) are mounted right now. The
 * shell reads it to hold back modals while a cockpit is on screen.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { create } from "zustand";

interface FlightScreenState {
  mounted: number;
  enter: () => void;
  leave: () => void;
}

export const useFlightScreenStore = create<FlightScreenState>((set) => ({
  mounted: 0,
  enter: () => set((s) => ({ mounted: s.mounted + 1 })),
  leave: () => set((s) => ({ mounted: Math.max(0, s.mounted - 1) })),
}));

/** Marks a flight screen as mounted for the lifetime of the calling component. */
export function useFlightScreenPresence(): void {
  useEffect(() => {
    useFlightScreenStore.getState().enter();
    return () => useFlightScreenStore.getState().leave();
  }, []);
}
