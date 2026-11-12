/**
 * @module drone-status-log-store
 * @description Per-drone ring buffer of flight-controller STATUSTEXT messages.
 *
 * Filled by the shell-level `StatusTextLogBridge` for every connected drone,
 * whether or not the Logs rail is open, so the rail shows what arrived while
 * it was closed and the "updates available" count keeps counting.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { LogMessage } from "@/hooks/use-drone-log-filter";

export const MAX_STATUS_LOG_MESSAGES = 1000;

const EMPTY: readonly LogMessage[] = [];

interface DroneStatusLogState {
  messages: Record<string, readonly LogMessage[]>;
  append: (droneId: string, severity: number, text: string, timestamp?: number) => void;
  clear: (droneId: string) => void;
}

let nextId = 0;

export const useDroneStatusLogStore = create<DroneStatusLogState>((set) => ({
  messages: {},
  append: (droneId, severity, text, timestamp = Date.now()) =>
    set((s) => {
      const prev = s.messages[droneId] ?? EMPTY;
      const next = [...prev, { id: nextId++, timestamp, severity, text }];
      return {
        messages: {
          ...s.messages,
          [droneId]:
            next.length > MAX_STATUS_LOG_MESSAGES ? next.slice(-MAX_STATUS_LOG_MESSAGES) : next,
        },
      };
    }),
  clear: (droneId) => set((s) => ({ messages: { ...s.messages, [droneId]: EMPTY } })),
}));

/** One drone's messages; a stable empty array when it has none. */
export function useDroneStatusLog(droneId: string): readonly LogMessage[] {
  return useDroneStatusLogStore((s) => s.messages[droneId] ?? EMPTY);
}
