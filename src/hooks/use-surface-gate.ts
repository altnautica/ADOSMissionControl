/**
 * @module useSurfaceGate
 * @description The single resolver for whether a tab or panel can render its
 * live content, and if not, why. Composes the connection + capability selectors
 * that already exist (drone-manager, agent-connection, command-fleet,
 * agent-capabilities, freshness) so per-surface copy and thresholds never drift.
 * Returns a discriminated GateResult; the surface renders LinkUpPlaceholder for
 * any non-"ok" mode.
 * @license GPL-3.0-only
 */

import { useDroneManager } from "@/stores/drone-manager";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useFreshness } from "@/lib/agent/freshness";
import { isDemoMode } from "@/lib/utils";
import { isFcReachable } from "@/lib/agent/mavlink-link";

/** What a surface needs in order to show live content. */
export type CapabilityKind =
  | "camera"
  | "npu"
  | "radio"
  | "vision"
  | "navigation"
  | "can";

export type SurfaceRequirement =
  /** Direct flight-controller link for this drone (USB / WS / BT). */
  | "fc"
  /** Any companion-computer agent paired (locked when none). */
  | "agent"
  /** A live agent heartbeat (offline / stale otherwise). */
  | "agent-online"
  /** The agent must have a flight controller attached to a serial port. */
  | "fc-on-agent"
  | `capability:${CapabilityKind}`;

export type GateMode =
  | "ok"
  | "locked"
  | "offline"
  | "stale"
  | "no-fc"
  | "fc-unverified"
  | "capability-missing"
  | "loading";

export interface GateResult {
  mode: GateMode;
  requirement: SurfaceRequirement;
  /** "Xs ago" style label for offline/stale copy. */
  lastSeenLabel?: string;
  /** Advertised FC serial port for the unverified case. */
  fcPort?: string;
  fcBaud?: number;
  /** Which capability is missing, for capability-missing copy. */
  capability?: CapabilityKind;
}

interface SurfaceGateOptions {
  /** Drone id for the FC-direct presence check. */
  droneId?: string | null;
  /** Agent device id for the FC-on-agent / capability lookups. Falls back to
   * the cloud-mode device id when omitted. */
  deviceId?: string | null;
}

const OK = (requirement: SurfaceRequirement): GateResult => ({
  mode: "ok",
  requirement,
});

/**
 * Resolve the gate for one surface. Reads every selector unconditionally
 * (rules of hooks) then branches on the requirement.
 */
export function useSurfaceGate(
  requirement: SurfaceRequirement,
  options: SurfaceGateOptions = {},
): GateResult {
  const { droneId, deviceId } = options;

  const fcPresent = useDroneManager((s) =>
    droneId ? s.drones.has(droneId) : s.drones.size > 0,
  );
  const fcCount = useDroneManager((s) => s.drones.size);

  const connected = useAgentConnectionStore((s) => s.connected);
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);

  const localNodeCount = useLocalNodesStore((s) => s.nodes.length);
  const pairedCount = usePairingStore((s) => s.pairedDrones.length);

  const resolvedDeviceId = deviceId ?? cloudDeviceId ?? null;
  const cloudStatus = useCommandFleetStore((s) =>
    resolvedDeviceId ? s.cloudStatuses[resolvedDeviceId] : undefined,
  );

  const capsLoaded = useAgentCapabilitiesStore((s) => s.loaded);
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const radio = useAgentCapabilitiesStore((s) => s.radio);
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const visionAvailable = useAgentCapabilitiesStore((s) => s.visionAvailable);
  const navigation = useAgentCapabilitiesStore((s) => s.navigation);
  const canBuses = useAgentCapabilitiesStore((s) => s.canBuses);

  const freshness = useFreshness();

  // Demo mode shows the full UI: every surface resolves ok so the 5 simulated
  // full-stack drones render normally.
  if (isDemoMode()) return OK(requirement);

  const anyAgent =
    connected || cloudMode || localNodeCount > 0 || pairedCount > 0;

  if (requirement === "fc") {
    // Direct flight-controller surface (drone detail tabs).
    if (droneId ? fcPresent : fcCount > 0) return OK(requirement);
    return { mode: "no-fc", requirement };
  }

  if (requirement === "agent") {
    // Discovery / locked: any paired agent unlocks the surface.
    if (anyAgent && connected) return OK(requirement);
    return { mode: "locked", requirement };
  }

  if (requirement === "agent-online") {
    if (!anyAgent) return { mode: "locked", requirement };
    if (!connected) {
      return { mode: "offline", requirement, lastSeenLabel: freshness.label };
    }
    if (freshness.state === "offline") {
      return { mode: "offline", requirement, lastSeenLabel: freshness.label };
    }
    if (freshness.state === "stale") {
      return { mode: "stale", requirement, lastSeenLabel: freshness.label };
    }
    // live, or connected with no heartbeat timestamp yet (unknown): render
    // content. The surface's own body handles a not-yet-populated store; we do
    // not block a live connection on the freshness clock.
    return OK(requirement);
  }

  if (requirement === "fc-on-agent") {
    if (!connected) return { mode: "loading", requirement };
    // No status row at all means we have no evidence either way. Absence of
    // data is not evidence of absent hardware, so never fall through to the
    // "no flight controller" copy on it — that asserts something we did not
    // and could not observe.
    if (!cloudStatus) return { mode: "loading", requirement };
    // Route through the canonical predicate rather than reading fcConnected
    // raw: an MSP flight controller (Betaflight/iNav) never emits the MAVLink
    // heartbeat fcConnected gates on, so the raw field reads false on a board
    // that is present and drivable. isFcReachable also honours the agent's own
    // fcReachable verdict, which outranks our inference.
    if (isFcReachable(cloudStatus)) return OK(requirement);
    if (cloudStatus?.fcPort) {
      return {
        mode: "fc-unverified",
        requirement,
        fcPort: cloudStatus.fcPort,
        fcBaud: cloudStatus.fcBaud,
      };
    }
    return { mode: "no-fc", requirement };
  }

  // capability:<kind>
  const capability = requirement.slice("capability:".length) as CapabilityKind;
  // Never claim a capability is absent before the first heartbeat lands.
  if (!capsLoaded) return { mode: "loading", requirement };

  const present = capabilityPresent(capability, {
    cameras,
    radio,
    compute,
    visionAvailable,
    navigation,
    canBuses,
  });
  if (present) return OK(requirement);
  return { mode: "capability-missing", requirement, capability };
}

interface CapabilitySnapshot {
  cameras: ReadonlyArray<unknown>;
  radio: unknown;
  compute: { npu_available?: boolean; npu_tops?: number };
  visionAvailable: boolean | undefined;
  navigation: unknown;
  canBuses: ReadonlyArray<unknown> | undefined;
}

function capabilityPresent(
  kind: CapabilityKind,
  caps: CapabilitySnapshot,
): boolean {
  switch (kind) {
    case "camera":
      return caps.cameras.length > 0;
    case "radio":
      return caps.radio !== null && caps.radio !== undefined;
    case "vision":
      return caps.visionAvailable === true;
    case "npu":
      return caps.compute.npu_available === true || (caps.compute.npu_tops ?? 0) > 0;
    case "navigation":
      return caps.navigation !== undefined && caps.navigation !== null;
    case "can":
      return Array.isArray(caps.canBuses) && caps.canBuses.length > 0;
    default:
      return true;
  }
}
