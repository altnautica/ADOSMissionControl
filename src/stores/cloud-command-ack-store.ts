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
  /** The delivery window the row was queued with. */
  ttlMs: number;
  /** Epoch ms when the command was queued; used to sweep lost commands. */
  queuedAt: number;
}

/** A queued command still awaiting a terminal status as handed into `watch`. */
export type NewOutstandingCloudCommand = Omit<OutstandingCloudCommand, "queuedAt">;

/**
 * Slack past the delivery window before a still-queued row is called expired.
 * Covers a poll that took the row right at the boundary whose `deliveredAt`
 * stamp has not yet reached this subscription.
 */
export const DELIVERY_WINDOW_GRACE_MS = 2_000;

/** The fields of a queue row the expiry verdict reads. */
export interface QueueRowSnapshot {
  status: "pending" | "delivering" | "completed" | "failed";
  deliveredAt?: number;
}

/**
 * True when a queued command's delivery window has closed and the node never
 * took it. The queue never hands such a row out, so the command can no longer
 * run and is reported failed. The server stamped the window before the enqueue
 * returned, so measuring from the local `queuedAt` never ends it early.
 */
export function expiredBeforeDelivery(
  command: OutstandingCloudCommand,
  row: QueueRowSnapshot | undefined,
  now: number,
): boolean {
  return (
    now >= command.queuedAt + command.ttlMs + DELIVERY_WINDOW_GRACE_MS &&
    row?.status === "pending" &&
    row.deliveredAt === undefined
  );
}

/**
 * Sweep horizon: a cloud command that has not resolved within 5 minutes is
 * presumed lost (e.g. a dropped network lane). Without this, a command whose
 * ACK never arrives would accumulate in `pending` forever.
 */
const PENDING_TTL_MS = 5 * 60 * 1000;

interface CloudCommandAckState {
  /** Queue rows still awaiting a terminal status. */
  pending: OutstandingCloudCommand[];
  /** Record a freshly-queued command to watch. Idempotent per commandId. */
  watch: (command: NewOutstandingCloudCommand) => void;
  /** Drop a command once its status is terminal (or it can no longer resolve). */
  resolve: (commandId: string) => void;
}

export const useCloudCommandAckStore = create<CloudCommandAckState>((set) => ({
  pending: [],
  watch: (command) =>
    set((s) => {
      const now = Date.now();
      if (s.pending.some((c) => c.commandId === command.commandId)) return s;
      // Sweep entries that outlived the TTL before adding, so a lost cloud
      // command cannot accumulate unbounded. Keeps `pending` bounded by the
      // command rate over one sweep horizon.
      const live = s.pending.filter((c) => now - c.queuedAt < PENDING_TTL_MS);
      return { pending: [...live, { ...command, queuedAt: now }] };
    }),
  resolve: (commandId) =>
    set((s) => {
      const next = s.pending.filter((c) => c.commandId !== commandId);
      return next.length === s.pending.length ? s : { pending: next };
    }),
}));
