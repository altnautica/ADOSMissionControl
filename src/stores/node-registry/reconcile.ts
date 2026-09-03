/**
 * @module NodeRegistry/reconcile
 * @description Pure helpers behind the node registry: nodeId derivation, the
 * garbage-collection predicate, and the side-effect-free merge functions the
 * store reducers compose. Keeping these pure makes them unit-testable in
 * isolation and lets the store stay a thin shell around them.
 *
 * These helpers back the live node registry the store composes from the
 * presence / connection / flight-controller bridges.
 *
 * @license GPL-3.0-only
 */

import type {
  NodeConnection,
  NodeEntry,
  NodeFc,
  NodePresence,
  PresenceSource,
} from "./types";

/**
 * Derive a canonical `nodeId` from a device identity.
 *
 * An agent node resolves to `"node:<deviceId>"`, stable across both the local
 * and cloud transports so the two presence observations of one physical node
 * collapse onto the same registry row. A direct flight controller with no
 * agent identity has no stable device id, so it gets a fresh `"fc:<randomId>"`
 * to avoid colliding with any other FC-only row.
 */
export function resolveNodeId(deviceId?: string): string {
  const trimmed = deviceId?.trim();
  if (trimmed) {
    return `node:${trimmed}`;
  }
  return `fc:${randomFcSuffix()}`;
}

/** A short, collision-resistant-enough suffix for an FC-only nodeId. */
function randomFcSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * An empty presence sub-state: no identity, no transports, no heartbeat.
 * Used as the seed when a node first appears via FC attach rather than a
 * presence observation.
 */
export function emptyPresence(): NodePresence {
  return {
    deviceId: "",
    name: "",
    profile: "drone",
    sources: [],
    lastHeartbeat: 0,
  };
}

/** An empty connection sub-state: nothing connected, no transport bound. */
export function emptyConnection(): NodeConnection {
  return { fcConnected: false };
}

/** An empty FC sub-state: no attached managed drone. */
export function emptyFc(): NodeFc {
  return { managedId: null };
}

/** A blank entry for a given nodeId. */
export function emptyEntry(nodeId: string): NodeEntry {
  return {
    nodeId,
    presence: emptyPresence(),
    connection: emptyConnection(),
    fc: emptyFc(),
    rev: 0,
  };
}

/**
 * The garbage-collection predicate. An entry may be removed only when it has
 * NO presence sources AND no attached flight controller. While either anchor
 * survives, the row stays.
 */
export function shouldRemoveEntry(entry: NodeEntry): boolean {
  const hasPresence = entry.presence.sources.length > 0;
  const hasFc = entry.fc.managedId !== null;
  return !hasPresence && !hasFc;
}

/** Add `source` to a sources list without duplicating it (order preserved). */
function withSource(
  sources: PresenceSource[],
  source: PresenceSource,
): PresenceSource[] {
  return sources.includes(source) ? sources : [...sources, source];
}

/** Remove `source` from a sources list. */
function withoutSource(
  sources: PresenceSource[],
  source: PresenceSource,
): PresenceSource[] {
  return sources.filter((s) => s !== source);
}

/**
 * Merge a presence observation from `source` into an existing presence
 * sub-state. Cloud is authoritative for identity fields (profile, role,
 * cloudPosture, cloudDeviceId, deviceId, name) when it supplies them; the
 * `sources` list gains `source`; `lastHeartbeat` keeps the freshest of the
 * existing value and any incoming value.
 *
 * The incoming patch is partial: a field only overrides when present. A local
 * patch never clobbers a cloud-authoritative field it does not carry, and a
 * cloud patch overrides whatever local previously set.
 */
export function mergePresence(
  current: NodePresence,
  patch: Partial<NodePresence>,
  source: PresenceSource,
): NodePresence {
  const isCloud = source === "cloud";

  // Identity fields: a present patch value always wins; otherwise keep
  // current. Cloud is the authority, but a field is only ever overwritten by
  // a value that was actually supplied, so a sparse local patch is harmless.
  const next: NodePresence = {
    deviceId: pick(patch.deviceId, current.deviceId),
    name: pick(patch.name, current.name),
    profile: pick(patch.profile, current.profile),
    role: pickOptional(patch.role, current.role, isCloud),
    cloudPosture: pickOptional(patch.cloudPosture, current.cloudPosture, isCloud),
    cloudDeviceId: pickOptional(
      patch.cloudDeviceId,
      current.cloudDeviceId,
      isCloud,
    ),
    // Monotonic: once any source has confirmed a real companion-agent
    // identity, a later patch — including one where the source currently
    // can't tell (e.g. a relay poll gap) — never regresses this back to
    // false, mirroring how lastHeartbeat only ever advances, never retreats.
    agentIdentityKnown:
      patch.agentIdentityKnown === true ? true : current.agentIdentityKnown,
    // A supplied hop always wins (freshest relay); an absent one keeps the
    // current value, so a later direct patch that carries no hop does not erase
    // the relay provenance. The relayed source dropping clears it (below).
    reachedVia: pickOptional(patch.reachedVia, current.reachedVia, true),
    sources: withSource(current.sources, source),
    lastHeartbeat: Math.max(
      current.lastHeartbeat,
      patch.lastHeartbeat ?? 0,
    ),
  };
  return next;
}

/**
 * Drop a single presence source from a presence sub-state, leaving the rest of
 * the identity intact. When the last source is removed the sub-state retains
 * its identity fields (so a re-appearance reuses them) but reports an empty
 * `sources` list, which the GC predicate reads.
 */
export function dropPresenceSource(
  current: NodePresence,
  source: PresenceSource,
): NodePresence {
  // Dropping the relay source clears the hop so a node that is no longer
  // relayed cannot keep advertising a stale "linked via WFB through X"
  // (Rule 44 — a reach surface never claims an unverified path).
  const reachedVia = source === "relayed" ? undefined : current.reachedVia;
  return {
    ...current,
    sources: withoutSource(current.sources, source),
    reachedVia,
  };
}

/** Merge a connection patch (only present fields override). */
export function mergeConnection(
  current: NodeConnection,
  patch: Partial<NodeConnection>,
): NodeConnection {
  return {
    mavlinkUrl: pickOptional(patch.mavlinkUrl, current.mavlinkUrl, true),
    transport: pickOptional(patch.transport, current.transport, true),
    fcConnected: patch.fcConnected ?? current.fcConnected,
    canCommand: pickOptional(patch.canCommand, current.canCommand, true),
  };
}

/** Merge an FC telemetry patch (only present fields override; managedId kept). */
export function mergeFcTelemetry(
  current: NodeFc,
  patch: Partial<NodeFc>,
): NodeFc {
  return {
    managedId: patch.managedId !== undefined ? patch.managedId : current.managedId,
    status: pickOptional(patch.status, current.status, true),
    flightMode: pickOptional(patch.flightMode, current.flightMode, true),
    armState: pickOptional(patch.armState, current.armState, true),
    healthScore: pickOptional(patch.healthScore, current.healthScore, true),
    firmwareVersion: pickOptional(
      patch.firmwareVersion,
      current.firmwareVersion,
      true,
    ),
    frameType: pickOptional(patch.frameType, current.frameType, true),
    lastHeartbeat: pickOptional(
      patch.lastHeartbeat,
      current.lastHeartbeat,
      true,
    ),
    battery: patch.battery
      ? { ...current.battery, ...patch.battery }
      : current.battery,
    gps: patch.gps ? { ...current.gps, ...patch.gps } : current.gps,
    position: patch.position
      ? { ...current.position, ...patch.position }
      : current.position,
  };
}

/**
 * Merge an FC telemetry patch into `target` IN PLACE and return whether
 * anything changed.
 *
 * The allocating {@link mergeFcTelemetry} above stays the reference semantics
 * and is what the unit tests pin. This is the hot-path variant: the FC bridge
 * calls it on every POSITION (5 Hz), BATTERY, GPS and HEARTBEAT frame, per
 * connected drone, so it must not allocate a new `NodeFc`, a new `NodeEntry`
 * or a new `nodes` map per packet.
 *
 * Returns false when the patch carried no defined field, so a no-op patch does
 * not bump the row's `rev` and does not invalidate the fleet projection.
 */
export function mergeFcTelemetryInPlace(
  target: NodeFc,
  patch: Partial<NodeFc>,
): boolean {
  let changed = false;
  if (patch.managedId !== undefined && patch.managedId !== target.managedId) {
    target.managedId = patch.managedId;
    changed = true;
  }
  if (patch.status !== undefined && patch.status !== target.status) {
    target.status = patch.status;
    changed = true;
  }
  if (patch.flightMode !== undefined && patch.flightMode !== target.flightMode) {
    target.flightMode = patch.flightMode;
    changed = true;
  }
  if (patch.armState !== undefined && patch.armState !== target.armState) {
    target.armState = patch.armState;
    changed = true;
  }
  if (patch.healthScore !== undefined && patch.healthScore !== target.healthScore) {
    target.healthScore = patch.healthScore;
    changed = true;
  }
  if (
    patch.firmwareVersion !== undefined &&
    patch.firmwareVersion !== target.firmwareVersion
  ) {
    target.firmwareVersion = patch.firmwareVersion;
    changed = true;
  }
  if (patch.frameType !== undefined && patch.frameType !== target.frameType) {
    target.frameType = patch.frameType;
    changed = true;
  }
  if (
    patch.lastHeartbeat !== undefined &&
    patch.lastHeartbeat !== target.lastHeartbeat
  ) {
    target.lastHeartbeat = patch.lastHeartbeat;
    changed = true;
  }
  // The three telemetry sub-objects are replaced rather than field-merged: a
  // decoder always emits a complete BatteryData / GpsData / PositionData, so a
  // partial merge would only preserve fields the FC has since stopped
  // reporting. One allocation per changed channel, not per patch.
  if (patch.battery !== undefined) {
    target.battery = target.battery
      ? Object.assign(target.battery, patch.battery)
      : { ...patch.battery };
    changed = true;
  }
  if (patch.gps !== undefined) {
    target.gps = target.gps
      ? Object.assign(target.gps, patch.gps)
      : { ...patch.gps };
    changed = true;
  }
  if (patch.position !== undefined) {
    target.position = target.position
      ? Object.assign(target.position, patch.position)
      : { ...patch.position };
    changed = true;
  }
  return changed;
}

/** Return `value` when it is not undefined, otherwise `fallback`. */
function pick<T>(value: T | undefined, fallback: T): T {
  return value !== undefined ? value : fallback;
}

/**
 * Optional-field picker. When `allowOverride` is false the current value is
 * kept regardless of the patch (used to protect cloud-authoritative identity
 * fields from a non-cloud patch). When true, a present patch value wins.
 */
function pickOptional<T>(
  value: T | undefined,
  fallback: T | undefined,
  allowOverride: boolean,
): T | undefined {
  if (value !== undefined && allowOverride) {
    return value;
  }
  return value !== undefined && fallback === undefined ? value : fallback;
}
