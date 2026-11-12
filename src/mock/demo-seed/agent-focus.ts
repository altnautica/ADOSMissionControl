/**
 * @module mock/demo-seed/agent-focus
 * @description Points the demo agent connection at the focused node and seeds
 * that node's capabilities.
 * @license GPL-3.0-only
 */

import { DEMO_AGENTS } from "./fleet";
import { useDroneManager } from "@/stores/drone-manager";
import type { PairedDrone } from "@/stores/pairing-store";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { DEMO_DRONES, DEMO_WORKSTATION } from "@/mock/drones";
import {
  getMockCapabilities,
  getMockGroundStationCapabilities,
  getMockVisorCapabilities,
  getMockWorkstationCapabilities,
  type MockPerceptionOverride,
} from "@/mock/agent/capabilities";
import { VISION_OFF_DEMO_DRONE } from "@/mock/mock-detections";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

/**
 * Name the focused demo drone as the node the demo agent connection serves, as
 * focusing a real node connects its agent with that node's device id. The
 * cockpit then reads the demo agent's reachability (and its failed polls) for
 * the drone on screen. An FC-only drone has no agent, so nothing is focused;
 * the non-flying nodes keep their seeded stores.
 */
export function focusDemoAgentNode(): void {
  const selId = useDroneManager.getState().selectedDroneId;
  const devId = selId ? (deviceIdFromNodeId(selId) ?? selId) : null;
  const drone = DEMO_DRONES.find((d) => d.id === devId && d.hasAgent !== false);
  useAgentConnectionStore.setState({ nodeDeviceId: drone?.id ?? null });
}

/**
 * One demo drone runs its detector by OFFLOADING to the workstation (no onboard
 * NPU); the rest run LOCAL on their own NPU, except the vision-off drone, whose
 * engine is not running (its detection stream reports `available:false`, so its
 * caps report the engine off too). Returns the perception override for a
 * companion drone, or null for a node that runs no perception (the FC-only
 * baseline, the workstation, the ground station) so we don't seed drone caps
 * over it.
 */
const OFFLOAD_DEMO_DRONE = "charlie-3";

/** The demo drone whose agent reports it runs against a simulator, so the node
 * header shows its SIM chip. */
const SIM_DEMO_DRONE = "delta-4";

function demoPerceptionFor(agent: PairedDrone): MockPerceptionOverride | null {
  // A companion drone has an onboard computer (board set); an FC-only drone or a
  // non-drone node has no perception surface to describe.
  if ((agent.profile ?? "drone") !== "drone" || !agent.board) return null;
  if (agent.deviceId === OFFLOAD_DEMO_DRONE) {
    return {
      perceptionTier: "offload",
      perceptionOffloadTarget: `${DEMO_WORKSTATION.deviceId}.local:8092`,
      npuTops: 0,
      hasAccelerator: false,
      npuAvailable: false,
    };
  }
  if (agent.deviceId === VISION_OFF_DEMO_DRONE) {
    return { perceptionTier: "local", perceptionOffloadTarget: null, visionEngineOff: true };
  }
  if (agent.deviceId === SIM_DEMO_DRONE) {
    return { perceptionTier: "local", perceptionOffloadTarget: null, sim: true };
  }
  return { perceptionTier: "local", perceptionOffloadTarget: null };
}

/**
 * Seed the singleton per-node capabilities store with the FOCUSED companion
 * drone's caps, tagged with its perception tier, so the Perception tier card +
 * the cockpit perception-health chip render a plausible LOCAL / OFFLOAD tier per
 * drone. Runs on selection (the poll never reloads caps in demo, and `selectDrone`
 * clears them on switch), not on the 2 s tick, so it never reverts live UI state.
 */
export function seedFocusedCapabilities(): void {
  const selId = useDroneManager.getState().selectedDroneId;
  const devId = selId ? (deviceIdFromNodeId(selId) ?? selId) : null;
  const agent = devId ? DEMO_AGENTS.find((a) => a.deviceId === devId) : undefined;
  if (!agent) return;
  // The ground station advertises its WFB radio + CRSF/ELRS control lane, so its
  // capability store gates the Radio + RC/ELRS Link tabs on (radioPresent /
  // crsfPresent). Leaner than a drone's caps (no NPU / vision).
  if (agent.profile === "ground-station") {
    // Each demo ground station reports its own role, so the receiver hides
    // its Radio tab while the direct station shows the multi-adapter view.
    useAgentCapabilitiesStore
      .getState()
      .setCapabilities({ ...getMockGroundStationCapabilities(), role: agent.role ?? "receiver" }, devId);
    return;
  }
  if (agent.profile === "visor") {
    useAgentCapabilitiesStore.getState().setCapabilities(getMockVisorCapabilities(), devId);
    return;
  }
  if (agent.profile === "workstation") {
    useAgentCapabilitiesStore.getState().setCapabilities(getMockWorkstationCapabilities(), devId);
    return;
  }
  const perception = demoPerceptionFor(agent);
  if (!perception) return;
  useAgentCapabilitiesStore
    .getState()
    .setCapabilities(getMockCapabilities("optical_flow", perception), devId);
}
