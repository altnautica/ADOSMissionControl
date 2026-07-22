"use client";

/**
 * Build a skill context for an arbitrary fleet node.
 *
 * The connection-backed builder in `registry.ts` targets the focused node: it
 * hands back a protocol only when the requested id is the selected drone, and
 * it reads arm state and flight mode from the app-wide drone store. That store
 * is written by EVERY connected drone's heartbeat, so its arm state belongs to
 * whichever vehicle beat last — not to the node being asked about. Feeding it
 * to a per-node control would gate one node's arm button on another node's
 * armed state, which is exactly the failure this module exists to avoid.
 *
 * So every field here is sourced per node:
 *
 *  - `protocol`  the node's own command sink (LAN or cloud relay).
 *  - `armState` / `flightMode`  the node's own telemetry snapshot, keyed by its
 *    device id in the fleet store.
 *  - `availableModes`  the mode table of the firmware the node's agent
 *    identified. Empty when the firmware is unidentified, which reports mode
 *    presets as unavailable rather than offering a mode the vehicle lacks.
 *
 * Two fields have no honest per-node source, and both resolve toward LESS
 * capability, never more:
 *
 *  - `supports`  capability flags come from a protocol handshake this node has
 *    not had, so every capability reads false. Mission-aware behaviour degrades
 *    to the plain mode change it falls back to.
 *  - `checklistReady`  the pre-flight checklist is app-wide and carries no node
 *    association, so it reads false. Arm and take-off then require the operator
 *    to type the override phrase instead of silently accepting a checklist that
 *    was completed for a different vehicle.
 *
 * Above all: with no telemetry snapshot proving the node's arm state, there is
 * no protocol at all. A command surface is offered only for a node whose live
 * state can actually be read, so a flight action is never dispatched blind.
 *
 * @module skills/node-context
 * @license GPL-3.0-only
 */

import type { FirmwareType, UnifiedFlightMode } from "@/lib/protocol/types";
import type { ArmState, FlightMode } from "@/lib/types";
import { asFlightMode } from "@/lib/flight-mode";
import { createFirmwareHandlerByType } from "@/lib/protocol/firmware/ardupilot";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import {
  resolveNodeCommandSink,
  type CommandTargetNode,
  type NodeCommandSinkOptions,
} from "@/lib/nodes/command-sink";
import { notifySkill } from "./registry";
import type { ConfirmPolicy, SkillContext } from "./types";

/** The node fields a per-node context reads. A fleet node entry satisfies it. */
export interface SkillTargetNode extends CommandTargetNode {
  /** Canonical fleet id — the key the dispatcher's per-node guards run on. */
  _id: string;
  /** FC firmware family the node's agent identified. */
  fcFirmware?: string;
  /** Short airframe label the node's agent reported. */
  frameType?: string;
}

export type NodeSkillContextOptions = NodeCommandSinkOptions;

/**
 * The neutral mode used when a node reports one this build does not know. It
 * names no autonomous behaviour, so nothing is inferred from it.
 */
const UNRECOGNISED_MODE: FlightMode = "MANUAL";

/** Airframe labels that share the multirotor mode table. */
const COPTER_FRAMES = new Set(["copter", "heli", "tricopter", "hexacopter"]);
/** Airframe labels that share the fixed-wing / VTOL mode table. */
const PLANE_FRAMES = new Set([
  "plane",
  "vtol",
  "tailsitter",
  "tiltrotor",
  "wing",
]);
/** Airframe labels that share the ground / surface mode table. */
const ROVER_FRAMES = new Set(["rover", "boat"]);

/**
 * Resolve the firmware build a node runs, from the family + airframe its agent
 * reported. The families that ship one mode table map directly; the ArduPilot
 * family needs the airframe to pick between its four builds. Returns null when
 * either is missing or unrecognised — a guess here would offer the operator
 * modes the vehicle does not have.
 */
export function firmwareTypeForNode(
  fcFirmware?: string,
  frameType?: string,
): FirmwareType | null {
  const family = fcFirmware?.trim().toLowerCase();
  if (!family) return null;
  if (family === "px4") return "px4";
  if (family === "betaflight") return "betaflight";
  if (family === "inav") return "inav";
  if (family !== "ardupilot") return null;

  const frame = frameType?.trim().toLowerCase();
  if (!frame) return null;
  if (COPTER_FRAMES.has(frame)) return "ardupilot-copter";
  if (PLANE_FRAMES.has(frame)) return "ardupilot-plane";
  if (ROVER_FRAMES.has(frame)) return "ardupilot-rover";
  if (frame === "sub") return "ardupilot-sub";
  return null;
}

/** The modes a node's firmware offers; empty when it is unidentified. */
export function availableModesForNode(
  fcFirmware?: string,
  frameType?: string,
): UnifiedFlightMode[] {
  const firmwareType = firmwareTypeForNode(fcFirmware, frameType);
  if (!firmwareType) return [];
  return createFirmwareHandlerByType(firmwareType).getAvailableModes();
}

/**
 * Build the skill context for `node`. Safe to call for any fleet node,
 * including one that is not selected and one the GCS holds no connection to.
 */
export function buildSkillContextForNode(
  node: SkillTargetNode,
  options: NodeSkillContextOptions = {},
): SkillContext {
  const status = useCommandFleetStore.getState().cloudStatuses[node.deviceId];
  const telemetry = status?.telemetry;

  // A boolean armed flag is the proof that this node's flight-controller state
  // is actually being read. Without it there is nothing to gate a flight
  // command on, so no command surface is offered at all.
  const armed =
    typeof telemetry?.armed === "boolean" ? telemetry.armed : null;
  const armState: ArmState = armed ? "armed" : "disarmed";
  const flightMode = asFlightMode(telemetry?.mode) ?? UNRECOGNISED_MODE;

  const sink = armed === null ? null : resolveNodeCommandSink(node, options);

  return {
    droneId: node._id,
    protocol: sink,
    armState,
    flightMode,
    availableModes: availableModesForNode(node.fcFirmware, node.frameType),
    // No per-node mode history exists. Reporting the current mode as the
    // previous one asserts no transition, so nothing infers a paused mission
    // from a mode change that was never observed.
    previousMode: flightMode,
    supports: () => false,
    checklistReady: false,
    confirm: (policy: ConfirmPolicy) =>
      useSkillConfirmStore.getState().request(policy),
    notify: notifySkill,
  };
}
