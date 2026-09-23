/**
 * @module useInstallTargetHost
 * @description The host facts an install is checked against (agent
 * version, board name and SoC, RAM), read for the install target's own
 * device id from the per-device status the fleet store keeps (the cloud
 * heartbeat or the LAN `/api/status/full` poll). Never the ambient
 * connection: a relayed drone must not be judged by the ground station
 * the operator happens to be attached to.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useCommandFleetStore } from "@/stores/command-fleet-store";

import type { CompatibilityHost } from "./check-compatibility";

export interface InstallTargetHost extends CompatibilityHost {
  /** Agent version the target reports, when it has reported one. */
  agentVersion?: string;
}

/**
 * Host facts for `deviceId`, or null when there is no target or the target
 * has not reported a status yet (every fact unknown).
 */
export function useInstallTargetHost(
  deviceId: string | null | undefined,
): InstallTargetHost | null {
  const status = useCommandFleetStore((s) =>
    deviceId ? s.cloudStatuses[deviceId] : undefined,
  );
  if (!status) return null;
  return {
    agentVersion: status.version,
    boardName: status.boardName,
    boardSoc: status.boardSoc,
    ramTotalMb: status.boardRamMb ?? status.memoryTotalMb,
  };
}
