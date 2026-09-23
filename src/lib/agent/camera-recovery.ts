/**
 * @module agent/camera-recovery
 * @description Single forward-permissive parser for the agent's air-side
 * USB camera recovery block. Shared by the LAN-direct full-status mapper,
 * the cloud heartbeat extras builder, and the capability-store normalizer
 * so the clamp rules never drift across the three ingest paths.
 *
 * The block is dropped entirely when `state` is absent or not one of the
 * known recovery states; the numeric and boolean fields are coerced
 * defensively so a single malformed heartbeat can never throw.
 * @license GPL-3.0-only
 */

import type { CameraUsbRecovery } from "./types";

const RECOVERY_STATES = [
  "idle",
  "monitoring",
  "rebinding",
  "port_cycling",
  "hub_resetting",
  "retrying",
  "needs_hub_reset",
  "guard_blocked",
] as const;

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Validate + coerce a raw camera-recovery payload onto the
 * `CameraUsbRecovery` shape. Returns `undefined` when the value is not an
 * object or its `state` is not a known recovery state — the whole block is
 * dropped rather than surfaced half-formed.
 */
export function normalizeCameraUsbRecovery(
  raw: unknown,
): CameraUsbRecovery | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const stateRaw = r.state;
  if (
    typeof stateRaw !== "string" ||
    !(RECOVERY_STATES as readonly string[]).includes(stateRaw)
  ) {
    return undefined;
  }
  return {
    state: stateRaw as CameraUsbRecovery["state"],
    case: typeof r.case === "string" && r.case.length > 0 ? r.case : null,
    attempts: numberOrZero(r.attempts),
    cooldownSeconds: numberOrZero(r.cooldownSeconds),
    cameraPresent: booleanOr(r.cameraPresent, false),
    expected: booleanOr(r.expected, false),
    pppsCapable: booleanOr(r.pppsCapable, false),
    powerContention: booleanOr(r.powerContention, false),
    contentionPeer:
      typeof r.contentionPeer === "string" && r.contentionPeer.length > 0
        ? r.contentionPeer
        : null,
  };
}

/** Recovery states where a self-heal episode is in progress: a missing camera
 * under watch, a step in flight, or the cooldown between two attempts. */
export const CAMERA_RECOVERY_ACTIVE_STATES = new Set<CameraUsbRecovery["state"]>(
  ["monitoring", "rebinding", "port_cycling", "hub_resetting", "retrying"],
);

/** Recovery states that need operator attention (reseat / unblock). */
export const CAMERA_RECOVERY_ATTENTION_STATES = new Set<
  CameraUsbRecovery["state"]
>(["needs_hub_reset", "guard_blocked"]);
