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
 *  - `armState` / `flightMode`  the node's own telemetry, read through the same
 *    merged view the board's display cells consume: the live stream a
 *    cloud-paired node publishes over MQTT first, the heartbeat row's snapshot
 *    (the LAN poll) as fallback. Reading only one map would blind the gate to
 *    exactly the nodes the other lane serves.
 *  - `availableModes`  the node's own live FC connection's mode table when the
 *    GCS holds one (the same source the cockpit reads); otherwise the table of
 *    the firmware build the node's agent identified; otherwise, for the
 *    ArduPilot family with no identified airframe, the modes every ArduPilot
 *    build shares — provably on the vehicle whatever it is. Empty only when
 *    the firmware family itself is unidentified, which reports mode presets as
 *    unavailable rather than offering a mode the vehicle lacks.
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
 * no protocol at all — and a snapshot from a node that is no longer being
 * heard from proves nothing, so an offline node's persisted telemetry is read
 * the same as none. A command surface is offered only for a node whose live
 * state can actually be read, so a flight action is never dispatched blind.
 *
 * @module skills/node-context
 * @license GPL-3.0-only
 */

import type { FirmwareType, UnifiedFlightMode } from "@/lib/protocol/types";
import type { ArmState, FlightMode } from "@/lib/types";
import { asFlightMode } from "@/lib/flight-mode";
import { createFirmwareHandlerByType } from "@/lib/protocol/firmware/ardupilot";
import { nodeLiveness, telemetryValue } from "@/lib/nodes/presence";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import {
  resolveNodeCommandSink,
  type CommandTargetNode,
  type NodeCommandSinkOptions,
} from "@/lib/nodes/command-sink";
import { notifySkill } from "./registry";
import type {
  AutonomousNavCapability,
  ConfirmPolicy,
  SkillContext,
} from "./types";

/** The node fields a per-node context reads. A fleet node entry satisfies it. */
export interface SkillTargetNode extends CommandTargetNode {
  /** Canonical fleet id — the key the dispatcher's per-node guards run on. */
  _id: string;
  /** FC firmware family the node's agent identified. */
  fcFirmware?: string;
  /** Short airframe label the node's agent reported. */
  frameType?: string;
  /** Newest heard-from timestamp the membership entry carries. Feeds the
   * liveness gate together with the heartbeat row's own timestamp. */
  lastSeen?: number;
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

/** The four ArduPilot builds; the airframe decides which one a node runs. */
const ARDUPILOT_BUILDS: readonly FirmwareType[] = [
  "ardupilot-copter",
  "ardupilot-plane",
  "ardupilot-rover",
  "ardupilot-sub",
];

let ardupilotCommonCache: UnifiedFlightMode[] | null = null;

/**
 * The modes present on EVERY ArduPilot build — provably on the vehicle
 * whatever its airframe turns out to be. Agents report the firmware family
 * but no airframe today, so requiring one would keep every ArduPilot node's
 * mode presets permanently disabled; offering a single build's full table
 * instead would enable modes another build lacks. Derived from the real mode
 * tables so it can never drift from them.
 */
function ardupilotCommonModes(): UnifiedFlightMode[] {
  if (!ardupilotCommonCache) {
    const [first, ...rest] = ARDUPILOT_BUILDS.map((build) =>
      createFirmwareHandlerByType(build).getAvailableModes(),
    );
    const restSets = rest.map((modes) => new Set(modes));
    ardupilotCommonCache = first.filter((mode) =>
      restSets.every((set) => set.has(mode)),
    );
  }
  return ardupilotCommonCache;
}

/**
 * The modes a node's reported firmware offers. The identified build's full
 * table when family + airframe resolve one; the cross-build common set when
 * only the ArduPilot family is known; empty when the family itself is
 * unidentified.
 */
export function availableModesForNode(
  fcFirmware?: string,
  frameType?: string,
): UnifiedFlightMode[] {
  const firmwareType = firmwareTypeForNode(fcFirmware, frameType);
  if (firmwareType) {
    return createFirmwareHandlerByType(firmwareType).getAvailableModes();
  }
  if (fcFirmware?.trim().toLowerCase() === "ardupilot") {
    return ardupilotCommonModes();
  }
  return [];
}

/**
 * Whether a node's reported firmware supports autonomous navigation (RTL / Land
 * / Takeoff), read from the firmware family's real capabilities rather than the
 * blanket-false `supports` a sink-backed context otherwise carries. The
 * identified build's own geofence capability when family + airframe resolve one;
 * "supported" for the ArduPilot family even without an airframe (every ArduPilot
 * build has autonomous nav, mirroring {@link availableModesForNode}'s family
 * fallback); "unknown" for any other unidentified firmware — never "unsupported",
 * so a node whose firmware simply has not been identified keeps those skills
 * rather than having them hidden on a guess.
 */
export function autonomousNavForNode(
  fcFirmware?: string,
  frameType?: string,
): AutonomousNavCapability {
  const firmwareType = firmwareTypeForNode(fcFirmware, frameType);
  if (firmwareType) {
    return createFirmwareHandlerByType(firmwareType).getCapabilities()
      .supportsGeoFence
      ? "supported"
      : "unsupported";
  }
  if (fcFirmware?.trim().toLowerCase() === "ardupilot") return "supported";
  return "unknown";
}

/**
 * Build the skill context for `node`. Safe to call for any fleet node,
 * including one that is not selected and one the GCS holds no connection to.
 */
export function buildSkillContextForNode(
  node: SkillTargetNode,
  options: NodeSkillContextOptions = {},
): SkillContext {
  const fleet = useCommandFleetStore.getState();
  const status = fleet.cloudStatuses[node.deviceId];
  const telemetry = telemetryValue(
    fleet.telemetryByDeviceId[node.deviceId],
    status,
  );

  // A boolean armed flag is the proof that this node's flight-controller state
  // is actually being read — and it only stays proof while the node itself is
  // being heard from. Both telemetry maps persist a node's last value after it
  // goes dark, so past the offline threshold the snapshot proves nothing: the
  // arm state reads unknown and no command surface is offered, on the same
  // clock the board's display cells go dark on.
  const offline = nodeLiveness(node, status) === "offline";
  const armed =
    !offline && typeof telemetry?.armed === "boolean" ? telemetry.armed : null;
  const armState: ArmState = armed ? "armed" : "disarmed";
  const flightMode = asFlightMode(telemetry?.mode) ?? UNRECOGNISED_MODE;

  const sink = armed === null ? null : resolveNodeCommandSink(node, options);

  // An agent-attached FC registers in the drone manager under this node's
  // canonical id, and its firmware handler is the ground truth for the mode
  // table — the same source the cockpit reads — so the board and the cockpit
  // offer one node the same presets. The family + airframe the agent reported
  // is the fallback for a node with no live FC connection in this browser.
  const managed = useDroneManager.getState().drones.get(node._id);
  const liveHandler =
    managed && managed.protocol.isConnected
      ? managed.protocol.getFirmwareHandler()
      : null;
  const availableModes =
    liveHandler?.getAvailableModes() ??
    availableModesForNode(node.fcFirmware, node.frameType);

  return {
    droneId: node._id,
    protocol: sink,
    armState,
    flightMode,
    availableModes,
    // No per-node mode history exists. Reporting the current mode as the
    // previous one asserts no transition, so nothing infers a paused mission
    // from a mode change that was never observed.
    previousMode: flightMode,
    supports: () => false,
    // Capability flags stay blanket-false (no handshake), but autonomous-nav
    // visibility is driven off the node's real firmware family instead, so a
    // sink-backed ArduPilot / PX4 / iNav node keeps RTL / Land / Takeoff while
    // an acro flight controller drops them — a truthful answer, not a guess.
    autonomousNav: autonomousNavForNode(node.fcFirmware, node.frameType),
    checklistReady: false,
    confirm: (policy: ConfirmPolicy) =>
      useSkillConfirmStore.getState().request(policy),
    notify: notifySkill,
  };
}
