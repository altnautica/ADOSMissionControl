/**
 * @module mission/plan-identity
 * @description Does the plan this device holds match the plan on the drone?
 *
 * The drone's agent publishes the flight controller's mission identity
 * (`mission.id`, `mission.total`, `mission.uploads_seen`). This device's
 * upload receipt holds what it sent: the MISSION_ACK `opaque_id`, the item
 * count and the agent's upload counter just before the upload. The plans
 * match when:
 *
 *   - the drone's `id` is non-zero and equals the receipt's `opaque_id`; or
 *   - the drone's `id` is 0, its `total` equals the receipt's, and the agent
 *     has seen no other client's upload since this device's (the counter is
 *     at most one above the value recorded before the upload).
 *
 * Without an agent mission state, or without a receipt, nothing is known.
 *
 * @license GPL-3.0-only
 */

import type { MissionState } from "@/lib/cockpit/layers/cockpit-frames";
import type { UploadReceipt } from "@/stores/upload-receipts-store";

export type PlanIdentity = "match" | "differs" | "unknown";

export function planIdentity(
  receipt: UploadReceipt | null | undefined,
  mission: MissionState | null | undefined,
): PlanIdentity {
  if (!mission || mission.state === null) return "unknown";
  const droneHasPlan = mission.state !== "none" && (mission.total ?? 0) > 0;
  if (!receipt) return droneHasPlan ? "differs" : "unknown";
  if (!droneHasPlan) return "differs";
  const id = mission.id ?? 0;
  if (id !== 0) return receipt.opaqueId === id ? "match" : "differs";
  if (receipt.total === undefined || mission.total !== receipt.total) return "differs";
  if (mission.uploadsSeen === null || receipt.uploadsSeenBefore === undefined) return "match";
  return mission.uploadsSeen <= receipt.uploadsSeenBefore + 1 ? "match" : "differs";
}
