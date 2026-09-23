/**
 * @module NodeRegistry/select-fleet-drones
 * @description Pure projection from the canonical node registry to the legacy
 * `FleetDrone[]` shape the rest of the GCS consumes. The registry is the single
 * write target; this projection is the single read surface. Keeping it pure
 * makes the dedupe / FC-less / liveness / no-cloud-overwrite behavior unit
 * testable in isolation.
 *
 * Mapping contract:
 *  - liveness = the freshest of presence.lastHeartbeat, fc.lastHeartbeat, and
 *    the command-fleet status updatedAt, so a LAN-only heartbeat keeps a node
 *    online even with no cloud row (fixes the false-OFFLINE bug);
 *  - battery / gps / position are present and arm / mode are real ONLY when an
 *    FC is attached (fc.managedId !== null). With no FC they are undefined,
 *    arm state is "unknown" and `fcAttached` is false, so the card hides them
 *    rather than rendering a fabricated disarmed / STABILIZE / 0% reading;
 *  - an attached FC whose link was lost (adapter link-loss, or a heartbeat
 *    older than the telemetry staleness window) projects `fcLinkLost`, arm
 *    state "unknown", and is never "armed" / "in_mission": the last heartbeat
 *    says nothing about an aircraft the GCS can no longer hear;
 *  - a cloud presence tick never writes the FC sub-state, so it can never
 *    overwrite live flight state;
 *  - `cloudDeviceId` and `healthScore` are carried only when a source actually
 *    supplied them. Neither is synthesized from the deviceId or from liveness,
 *    so a node reached only through a relay advertises no agent identity and a
 *    node nothing measured advertises no health;
 *  - cloud-only display pills (Direct / camera / nav / peer / …) come
 *    from the command-fleet status keyed by deviceId, merged in here.
 *
 * @license GPL-3.0-only
 */

import type { ArmState, FleetDrone, FlightMode } from "@/lib/types/drone";
import type { CommandCloudStatus } from "@/stores/command-fleet-store";
import { livenessFromTimestamp } from "@/lib/nodes/presence";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import type { NodeEntry } from "./types";

/** Inputs to the pure projection. */
export interface SelectFleetDronesInput {
  /** Every known node, keyed by stable nodeId. */
  nodes: Record<string, NodeEntry>;
  /** Cloud / LAN command-fleet display status, keyed by deviceId. */
  cloudStatuses: Record<string, CommandCloudStatus>;
  /** Reference "now" in epoch ms (passed so callers tick on the shared clock). */
  now: number;
}

/** Narrow an arbitrary string to the FleetDrone profile union. */
function asProfile(
  p: NodeEntry["presence"]["profile"],
): FleetDrone["profile"] {
  return p === "ground-station" || p === "workstation" ? p : "drone";
}

/** Narrow the ground-station role to the FleetDrone role union. */
function asRole(r: NodeEntry["presence"]["role"]): FleetDrone["role"] {
  return r === "direct" || r === "relay" || r === "receiver" ? r : undefined;
}

/** Narrow an arbitrary cameraState string to the fleet-card union. */
function asCameraState(s: string | null | undefined): string | null {
  return s === "ready" || s === "missing" || s === "error" ? s : null;
}

/**
 * The freshest heartbeat across every source for a node. Single-sourced so the
 * row projection and the projector's liveness cache key cannot drift apart.
 */
export function freshestHeartbeat(
  entry: NodeEntry,
  status: CommandCloudStatus | undefined,
): number {
  return Math.max(
    entry.presence.lastHeartbeat,
    entry.fc.lastHeartbeat ?? 0,
    status?.updatedAt ?? 0,
  );
}

/**
 * True when an attached FC has reported at least one heartbeat and has since
 * gone silent: the adapter flagged link loss (status "offline" / arm state
 * "unknown") or the newest heartbeat is past the staleness window. An FC that
 * has not reported yet is not lost, only not heard from.
 */
function isFcLinkLost(entry: NodeEntry, now: number): boolean {
  const { fc } = entry;
  if (fc.managedId === null || fc.lastHeartbeat === undefined) return false;
  return (
    fc.status === "offline" ||
    fc.armState === "unknown" ||
    now - fc.lastHeartbeat >= TELEMETRY_STALE_MS
  );
}

/**
 * Project a single {@link NodeEntry} (plus its cloud display status, if any)
 * into a {@link FleetDrone}. Pure: identical inputs yield identical output.
 */
export function nodeEntryToFleetDrone(
  entry: NodeEntry,
  status: CommandCloudStatus | undefined,
  now: number,
): FleetDrone {
  const { presence, connection, fc } = entry;
  const deviceId = presence.deviceId || null;
  const fcAttached = fc.managedId !== null;

  // Liveness = freshest heartbeat across presence, FC, and the cloud status,
  // measured against the caller-supplied `now` (so the projection is pure and
  // ticks on the shared 1Hz clock). A LAN-only node with a fresh presence
  // heartbeat but no cloud row stays online (fixes the false-OFFLINE bug); a
  // node is offline only once EVERY source is past the offline threshold.
  const lastHeartbeat = freshestHeartbeat(entry, status);
  const online = isOnline(entry, status, now);

  const profile = asProfile(presence.profile);
  const role = asRole(presence.role);

  // Arm state is real only from a live FC heartbeat. A lost link, an FC that
  // has not reported yet, and a node with no FC all read "unknown", so neither
  // a confident ARM nor a fabricated disarmed survives the link.
  const fcLinkLost = isFcLinkLost(entry, now);
  const armState: ArmState =
    fcAttached && !fcLinkLost ? (fc.armState ?? "unknown") : "unknown";
  const armed = armState === "armed";

  // Connection state: a live, armed FC reports its arm state; otherwise the
  // node is just "connected" (online) or "disconnected" (stale/offline).
  const connectionState: FleetDrone["connectionState"] = armed
    ? "armed"
    : online
      ? "connected"
      : "disconnected";

  // Status: a live, armed FC is in_mission; an online node is online; a dead
  // one is offline. No fabricated "idle" for an FC-less but present agent.
  const droneStatus: FleetDrone["status"] = armed
    ? "in_mission"
    : online
      ? "online"
      : "offline";

  return {
    id: entry.nodeId,
    name:
      presence.name ||
      (deviceId ? `Agent ${deviceId.slice(0, 8)}` : "Drone"),
    status: droneStatus,
    connectionState,
    // Mode is FC-gated: only real when an FC is attached. With none, default
    // to a benign STABILIZE that the card hides via `fcAttached === false`.
    flightMode: fcAttached
      ? ((fc.flightMode as FlightMode | undefined) ?? "STABILIZE")
      : "STABILIZE",
    armState,
    lastHeartbeat,
    firmwareVersion: fc.firmwareVersion,
    frameType: fc.frameType,
    // Health is real only when something measured it. Nothing derives a health
    // score from mere liveness, so an online node with no reading leaves this
    // undefined and the card renders a placeholder rather than a confident 80%.
    healthScore: fc.healthScore,
    hasAgent: presence.sources.length > 0,
    fcAttached,
    fcLinkLost,
    // Source / cloud identity come from presence, never from FC telemetry.
    source: presence.sources.includes("cloud") ? "cloud" : "local",
    // Transitive-reach provenance: the ground node this drone is linked
    // through, when it is (also) enrolled via a relay. The reach precedence
    // (a direct local/cloud source, when present) still decides the primary
    // reach the UX shows; this only names the WFB hop.
    reachedVia: presence.reachedVia,
    // Only the transports that actually hold an agent identity for this node
    // (the LAN pair, the cloud pair) publish cloudDeviceId. A node seen ONLY
    // through another node's radio relay has no such identity, so it stays
    // undefined here — falling back to the bare deviceId would mint a reach the
    // GCS does not have and every consumer downstream would act on it.
    cloudDeviceId: presence.cloudDeviceId,
    cloudPosture: presence.cloudPosture,
    agentIdentityKnown: presence.agentIdentityKnown,
    profile,
    role,
    // FC-gated telemetry: undefined when no FC is attached so the card shows
    // no fabricated battery / position / fix.
    position: fcAttached ? fc.position : undefined,
    battery: fcAttached ? fc.battery : undefined,
    gps: fcAttached ? fc.gps : undefined,
    // ── Cloud-only display pills, merged by deviceId ──────────────
    attachedDisplayType: status?.attachedDisplayType,
    profileSource: status?.profileSource,
    manualMavlinkWsUrl:
      status?.manualMavlinkWsUrl ?? connection.mavlinkUrl ?? undefined,
    navigationGpsDenied: status?.navigationGpsDenied,
    navigationMode: status?.navigationMode,
    peerDeviceId: status?.peerDeviceId,
    peerRssiDbm: status?.peerRssiDbm,
    cameraState: asCameraState(status?.cameraState),
    cameraUsbRecovery: status?.cameraUsbRecovery,
    fcLinkHint: status?.fcLinkHint,
    fcFirmware: status?.fcFirmware,
    fcVariant: status?.fcVariant,
    transportOpen: status?.transportOpen,
    boardName: status?.boardName,
    boardSoc: status?.boardSoc,
    boardTier: status?.boardTier,
  };
}

/**
 * Project the whole registry into a `FleetDrone[]`. One physical node yields
 * exactly one row (the registry already collapsed both transports onto one
 * nodeId), sorted by name for a stable list order.
 */
export function selectFleetDrones(input: SelectFleetDronesInput): FleetDrone[] {
  const { nodes, cloudStatuses, now } = input;
  const rows = Object.values(nodes).map((entry) => {
    const status = entry.presence.deviceId
      ? cloudStatuses[entry.presence.deviceId]
      : undefined;
    return nodeEntryToFleetDrone(entry, status, now);
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** One cached projection of one node. */
interface CachedRow {
  /** The entry `rev` this row was projected from. */
  rev: number;
  /** The cloud status object identity this row was projected from. */
  status: CommandCloudStatus | undefined;
  /** Whether the row read as online at projection time. */
  online: boolean;
  /** Whether the row's FC link read as lost at projection time. */
  fcLinkLost: boolean;
  row: FleetDrone;
}

/**
 * A stateful, identity-preserving fleet projector. One instance per consumer.
 */
export type FleetDronesProjector = (
  input: SelectFleetDronesInput,
) => FleetDrone[];

/**
 * Create a memoizing wrapper around {@link selectFleetDrones} that preserves
 * object identity for rows — and for the whole array — that did not change.
 *
 * Why this exists: `useFleetStore((s) => s.drones)` selects the array, so a
 * fresh array reference re-renders all nine of its consumers even when nothing
 * about the fleet moved. The projection itself is cheap; replacing the array is
 * what cost. Reference stability turns a fleet tick with no change into zero
 * re-renders.
 *
 * `online` and the FC link verdict are derived from `now`, so both are part of
 * the cache key: the 1 Hz clock tick correctly re-projects any row crossing
 * the offline or heartbeat-staleness threshold and leaves every other row
 * alone.
 *
 * Stateful by design — one instance per consumer. Not for use inside a pure
 * test of the projection; call {@link selectFleetDrones} for that.
 */
export function createFleetDronesProjector(): FleetDronesProjector {
  let cache: Record<string, CachedRow> = {};
  let lastResult: FleetDrone[] = [];

  return (input) => {
    const { nodes, cloudStatuses, now } = input;
    const nextCache: Record<string, CachedRow> = {};
    const rows: FleetDrone[] = [];
    let changed = false;
    let seen = 0;

    for (const nodeId in nodes) {
      const entry = nodes[nodeId];
      const status = entry.presence.deviceId
        ? cloudStatuses[entry.presence.deviceId]
        : undefined;
      const cached = cache[nodeId];
      // `online` and the FC link verdict flip purely on elapsed time, so a
      // cached row is only valid while both still hold at this `now`.
      const online = isOnline(entry, status, now);
      const fcLinkLost = isFcLinkLost(entry, now);
      if (
        cached !== undefined &&
        cached.rev === entry.rev &&
        cached.status === status &&
        cached.online === online &&
        cached.fcLinkLost === fcLinkLost
      ) {
        nextCache[nodeId] = cached;
        rows.push(cached.row);
      } else {
        const row = nodeEntryToFleetDrone(entry, status, now);
        nextCache[nodeId] = { rev: entry.rev, status, online, fcLinkLost, row };
        rows.push(row);
        changed = true;
      }
      seen++;
    }

    // A removed node changes the set without invalidating any surviving row.
    if (seen !== lastResult.length) changed = true;

    cache = nextCache;
    if (!changed) return lastResult;
    rows.sort((a, b) => a.name.localeCompare(b.name));
    lastResult = rows;
    return rows;
  };
}

/**
 * The liveness verdict {@link nodeEntryToFleetDrone} derives, extracted so the
 * projector can use it as a cache key without building a whole row.
 */
function isOnline(
  entry: NodeEntry,
  status: CommandCloudStatus | undefined,
  now: number,
): boolean {
  return livenessFromTimestamp(freshestHeartbeat(entry, status), now) !== "offline";
}
