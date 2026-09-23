/**
 * @module upload-receipts-store
 * @description What the GCS knows it put on each aircraft.
 *
 * A receipt is written only when the flight controller confirmed an upload of
 * a mission, fence or rally set. It records which drone received it and a hash
 * of the exact content sent. Every "on aircraft" claim in the UI is derived by
 * comparing the receipt against the selected drone and the hash of what the
 * planner would upload now, so an edit, a plan switch or a drone switch can
 * never keep showing a stale "uploaded". Receipts are dropped when the drone
 * disconnects: after a reconnect the GCS no longer knows what the FC holds.
 *
 * Not persisted: a reload has no live link, so it has nothing to vouch for.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export type UploadKind = "mission" | "fence" | "rally";

export interface UploadReceipt {
  /** Drone whose flight controller acknowledged the upload. */
  droneId: string;
  /** {@link contentHash} of the content that was uploaded. */
  contentHash: string;
  /** Epoch ms of the acknowledgement. */
  at: number;
  /**
   * Mission receipts only: the upload reserved ArduPilot's home slot at seq 0,
   * so mission seq N is the (N-1)th expanded item.
   */
  homeSlot?: boolean;
}

/**
 * How the selected drone's copy relates to the planner's current content:
 * - `on-aircraft`: this drone acknowledged exactly this content.
 * - `older-on-aircraft`: this drone acknowledged different content.
 * - `unknown`: no receipt for this drone.
 */
export type ReceiptStatus = "on-aircraft" | "older-on-aircraft" | "unknown";

interface UploadReceiptsState {
  /** droneId → kind → receipt. */
  receipts: Record<string, Partial<Record<UploadKind, UploadReceipt>>>;
  record: (kind: UploadKind, receipt: UploadReceipt) => void;
  /** Forget what a drone holds (disconnect, or an upload that failed mid-way). */
  clearForDrone: (droneId: string) => void;
  clearKindForDrone: (kind: UploadKind, droneId: string) => void;
}

export const useUploadReceiptsStore = create<UploadReceiptsState>()((set) => ({
  receipts: {},
  record: (kind, receipt) =>
    set((s) => ({
      receipts: {
        ...s.receipts,
        [receipt.droneId]: { ...s.receipts[receipt.droneId], [kind]: receipt },
      },
    })),
  clearForDrone: (droneId) =>
    set((s) => {
      if (!(droneId in s.receipts)) return s;
      const receipts = { ...s.receipts };
      delete receipts[droneId];
      return { receipts };
    }),
  clearKindForDrone: (kind, droneId) =>
    set((s) => {
      const forDrone = s.receipts[droneId];
      if (!forDrone?.[kind]) return s;
      const next = { ...forDrone };
      delete next[kind];
      return { receipts: { ...s.receipts, [droneId]: next } };
    }),
}));

/** The receipt for `kind` on `droneId`, if one exists. */
export function receiptFor(
  kind: UploadKind,
  droneId: string | null | undefined,
): UploadReceipt | undefined {
  if (!droneId) return undefined;
  return useUploadReceiptsStore.getState().receipts[droneId]?.[kind];
}

/** Compare a receipt with the content hash the planner would upload now. */
export function receiptStatus(
  receipt: UploadReceipt | undefined,
  currentHash: string,
): ReceiptStatus {
  if (!receipt) return "unknown";
  return receipt.contentHash === currentHash ? "on-aircraft" : "older-on-aircraft";
}

/**
 * Stable content hash: 32-bit FNV-1a over the JSON encoding, as 8 hex digits.
 * Callers pass plain data with a fixed key order (built by the caller), so the
 * same content always hashes the same.
 */
export function contentHash(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
