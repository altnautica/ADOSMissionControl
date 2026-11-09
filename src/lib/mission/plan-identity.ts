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
 *   - the drone's `id` is 0, its `total` equals the number of mission items
 *     the receipt sent (the ArduPilot home slot excluded, as MISSION_CURRENT
 *     counts them), and the agent has seen no other client's upload since
 *     this device's (the counter is at most one above the value recorded
 *     before the upload).
 *
 * Without an agent mission state, or without a receipt, nothing is known. A
 * flight controller that reports no `total` (0 or absent; older firmware)
 * gives nothing to compare, so the plans are not claimed to differ.
 *
 * @license GPL-3.0-only
 */

import type { MissionState } from "@/lib/hud/cockpit-frames";
import type { UploadReceipt } from "@/stores/upload-receipts-store";

export type PlanIdentity = "match" | "differs" | "unknown";

export function planIdentity(
  receipt: UploadReceipt | null | undefined,
  mission: MissionState | null | undefined,
): PlanIdentity {
  if (!mission || mission.state === null) return "unknown";
  const id = mission.id ?? 0;
  const totalReported = (mission.total ?? 0) > 0;
  const droneHasPlan = mission.state !== "none" && totalReported;
  if (!receipt) return droneHasPlan ? "differs" : "unknown";
  if (id !== 0) return receipt.opaqueId === id ? "match" : "differs";
  if (!totalReported) return "unknown";
  if (mission.state === "none") return "differs";
  if (receipt.total === undefined) return "differs";
  const sentItems = receipt.total - (receipt.homeSlot ? 1 : 0);
  if (mission.total !== sentItems) return "differs";
  if (mission.uploadsSeen === null || receipt.uploadsSeenBefore === undefined) return "match";
  return mission.uploadsSeen <= receipt.uploadsSeenBefore + 1 ? "match" : "differs";
}
