/**
 * @module NodeRegistry/types
 * @description Type definitions for the canonical node registry: the single
 * source of fleet identity, keyed by a stable `nodeId`. One {@link NodeEntry}
 * holds presence, connection, and flight-controller state as three independent
 * sub-states so that a single physical node (an agent, optionally with an
 * attached FC, optionally seen over both local and cloud transports) collapses
 * to exactly one row.
 *
 * The registry is live: the presence / connection / flight-controller bridges
 * feed it and the fleet surfaces project `NodeEntry` back into the existing
 * fleet shape, so a single physical node collapses to exactly one row across
 * every transport it is seen on.
 *
 * @license GPL-3.0-only
 */

import type {
  PositionData,
  BatteryData,
  GpsData,
} from "@/lib/types/telemetry";

/**
 * Which transport a presence observation arrived on. A node can be seen on
 * more than one at once; every source must drop before the presence sub-state
 * clears.
 *
 * `"relayed"` marks a node the GCS never paired with directly — it is enrolled
 * transitively because a directly-paired ground node reports it as its WFB peer
 * (the field case: pair GCS↔ground, the WFB-linked drone auto-enrolls). Its
 * {@link NodePresence.reachedVia} names that ground node. When a `"relayed"`
 * node is later paired directly, the direct source joins the same entry and
 * takes display precedence — the row upgrades in place rather than duplicating.
 */
export type PresenceSource = "local" | "cloud" | "relayed";

/**
 * The wire-contract node profile. Drives node grouping and panel selection.
 */
export type NodeProfile = "drone" | "ground-station" | "workstation";

/**
 * Ground-station role when the profile is "ground-station". Null / undefined
 * on drones and compute nodes.
 */
export type NodeRole = "direct" | "relay" | "receiver" | null;

/**
 * Cloud posture chosen on the agent. "local" means the agent intentionally
 * disabled the cloud relay (correct default since the beacon-off release), so
 * an offline-by-design node is distinguishable from one that dropped off.
 */
export type NodeCloudPosture = "local" | "cloud" | "self_hosted";

/**
 * MAVLink transport binding for the node's connection sub-state.
 */
export type NodeTransport = "websocket" | "mqtt-mavlink";

/**
 * Arming state mirrored from the attached FC.
 */
export type NodeArmState = "disarmed" | "armed";

/**
 * Presence sub-state: who/what/where the node is, and on which transport(s)
 * it was last observed. A node may carry presence from `local`, `cloud`, or
 * both at once; the merged view here is the union with cloud-authoritative
 * identity fields and local-or-cloud freshness, whichever is more recent.
 */
export interface NodePresence {
  /** Stable agent device id (the key material behind a `node:` nodeId). */
  deviceId: string;
  /** Operator-visible name from the agent heartbeat. */
  name: string;
  /** Node profile from the heartbeat. Defaults to "drone" upstream. */
  profile: NodeProfile;
  /** Ground-station role; null / undefined on non-GS nodes. */
  role?: NodeRole;
  /** Cloud posture as reported by the agent. */
  cloudPosture?: NodeCloudPosture;
  /** Cloud device id used for relay pairing; present for cloud-seen nodes. */
  cloudDeviceId?: string;
  /** True once ANY source has confirmed this node runs a real companion-
   * computer agent, distinct from `cloudDeviceId` ("the GCS can address this
   * device directly"). A relay-only node has no `cloudDeviceId` but can still
   * report this true once the ground station relays the peer's identity.
   * Monotonic in `mergePresence` — never regresses once true (see there). */
  agentIdentityKnown?: boolean;
  /**
   * The transports this presence was observed on. Empty means no live
   * presence source; combined with a null `fc.managedId` it makes the entry
   * eligible for garbage collection.
   */
  sources: PresenceSource[];
  /**
   * For a `"relayed"` node, the `node:<deviceId>` id of the ground node the
   * drone is linked through (its WFB reach hop). Undefined on a directly-reached
   * node. Set by the relayed presence patch; cleared when the relayed source is
   * dropped (so a node that is no longer relayed stops advertising a stale hop,
   * Rule 44). A later direct source does not clear it, so a directly-paired node
   * that is ALSO relay-visible keeps the hop as secondary provenance while the
   * `sources` precedence shows the direct reach as primary.
   */
  reachedVia?: string;
  /** Epoch ms of the freshest presence observation across all sources. */
  lastHeartbeat: number;
}

/**
 * Connection sub-state: how the GCS reaches the node's MAVLink stream, and
 * whether the node currently reports an attached, connected flight controller.
 */
export interface NodeConnection {
  /** Direct LAN MAVLink WebSocket URL the agent advertises, if any. */
  mavlinkUrl?: string;
  /** The transport carrying MAVLink for this node, if connected. */
  transport?: NodeTransport;
  /** True when the agent reports a connected flight controller. */
  fcConnected: boolean;
  /**
   * True when a command sent over that transport actually reaches the vehicle.
   *
   * Distinct from `fcConnected`, which says the flight controller is attached
   * and talking. Over the cloud relay both can disagree: telemetry arrives on
   * the receive lane while the send lane is refused by the broker, so the node
   * is connected, healthy, and uncommandable at the same time. Absent means not
   * yet established rather than false, so a reader must not treat a missing
   * value as a refusal.
   */
  canCommand?: boolean;
}

/**
 * Battery telemetry mirrored from the attached FC. The full
 * {@link BatteryData} shape passes through verbatim so the fleet projection
 * is lossless (the registry is a mirror, no field flattening).
 */
export type NodeFcBattery = BatteryData;

/** GPS fix telemetry mirrored from the attached FC (full {@link GpsData}). */
export type NodeFcGps = GpsData;

/** Position / pose telemetry mirrored from the attached FC (full {@link PositionData}). */
export type NodeFcPosition = PositionData;

/**
 * Flight-controller sub-state: the drone-manager managed id of the attached
 * FC plus the latest telemetry bridged from it. `managedId` is the second
 * survival anchor: while it is non-null the entry is never garbage-collected,
 * even with zero presence sources (a direct-USB FC has no agent presence).
 */
export interface NodeFc {
  /** drone-manager `ManagedDrone.id` of the attached FC, or null when none. */
  managedId: string | null;
  status?: string;
  flightMode?: string;
  armState?: NodeArmState;
  healthScore?: number;
  firmwareVersion?: string;
  frameType?: string;
  lastHeartbeat?: number;
  battery?: NodeFcBattery;
  gps?: NodeFcGps;
  position?: NodeFcPosition;
}

/**
 * A canonical node-registry entry. Exactly one per stable `nodeId`.
 *
 * `nodeId` is `"node:<deviceId>"` for an agent node (stable across the local
 * and cloud transports) or `"fc:<randomId>"` for a direct flight controller
 * with no agent identity.
 */
export interface NodeEntry {
  nodeId: string;
  presence: NodePresence;
  connection: NodeConnection;
  fc: NodeFc;
  /**
   * Monotonic mutation counter for this row.
   *
   * FC telemetry is merged into `fc` IN PLACE at 5-30 Hz (see the store's
   * `updateFcTelemetry`), so entry object identity is deliberately NOT a
   * change signal — cloning the whole `nodes` map per position packet is what
   * made one packet re-render the dashboard cards, both maps, node detail and
   * the planner. `rev` is the per-row signal the fleet projection memoizes on:
   * an unchanged row keeps its projected `FleetDrone` object identity and its
   * consumers bail out of re-rendering.
   */
  rev: number;
}
