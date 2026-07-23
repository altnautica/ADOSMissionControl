/**
 * Outstanding cloud-relay commands awaiting the vehicle's own answer.
 *
 * The cloud command lane is store-and-forward: enqueueing a command returns only
 * "queued", never the vehicle's acknowledgement, which lands later on the queue
 * row. This store holds the row ids that are still in flight so a mounted watcher
 * can subscribe to each row's terminal status and surface the real answer once it
 * arrives — an honest accepted/rejected instead of a permanent "queued".
 *
 * Entries are added the instant a command is queued (via the command sink's
 * `onQueued` seam) and removed once their status reaches a terminal state, so the
 * set stays bounded by what is actually outstanding.
 *
 * @module stores/cloud-command-ack-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** One queued cloud command still awaiting the vehicle's answer. */
export interface OutstandingCloudCommand {
  /** The cloud queue row id to watch. */
  commandId: string;
  /** The device the command was queued for, for a node-specific message. */
  deviceId: string;
}

interface CloudCommandAckState {
  /** Queue rows still awaiting a terminal status. */
  pending: OutstandingCloudCommand[];
  /** Record a freshly-queued command to watch. Idempotent per commandId. */
  watch: (command: OutstandingCloudCommand) => void;
  /** Drop a command once its status is terminal (or it can no longer resolve). */
  resolve: (commandId: string) => void;
}

export const useCloudCommandAckStore = create<CloudCommandAckState>((set) => ({
  pending: [],
  watch: (command) =>
    set((s) =>
      s.pending.some((c) => c.commandId === command.commandId)
        ? s
        : { pending: [...s.pending, command] },
    ),
  resolve: (commandId) =>
    set((s) => {
      const next = s.pending.filter((c) => c.commandId !== commandId);
      return next.length === s.pending.length ? s : { pending: next };
    }),
}));
