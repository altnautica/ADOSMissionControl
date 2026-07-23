"use client";

/**
 * Resolve the live command surface of a directly-connected flight controller.
 *
 * A direct FC (USB / serial / TCP / BT / WS) is opened by a connection panel and
 * tracked in the drone manager keyed by its own id — the same string a direct-FC
 * fleet node carries as its device id. It has no agent behind it and so no agent
 * command lane, but it does have a live `DroneProtocol` the cockpit already
 * drives. This reads that protocol imperatively at call time (the Rule-39
 * local-first pattern the LAN agent lookup uses), so a fleet-operations surface
 * can command a plugged-in FC through its own link rather than refusing it.
 *
 * Returns null when no such FC is connected under that id, so a surface falls
 * back to its honest "no reach" state instead of acting on a stale connection.
 *
 * @module nodes/direct-fc-protocol
 * @license GPL-3.0-only
 */

import type { SkillProtocol } from "@/lib/skills/skill-protocol";
import { useDroneManager } from "@/stores/drone-manager";

/**
 * The live command surface of the directly-connected FC keyed by `id`, or null
 * when none is connected. A live `DroneProtocol` satisfies `SkillProtocol`
 * structurally, so it drops straight into a skill context or command sink.
 */
export function resolveDirectFcProtocol(id: string): SkillProtocol | null {
  const managed = useDroneManager.getState().drones.get(id);
  if (!managed || !managed.protocol.isConnected) return null;
  return managed.protocol;
}
