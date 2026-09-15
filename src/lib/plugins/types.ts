/**
 * Plugin host types. Shared by the bridge, the iframe host, the slot
 * registry, and Convex client wrappers.
 */

import type { GcsCapability } from "./capabilities";

export type PluginHalf = "agent" | "gcs";

export type PluginInstallStatus =
  | "installed"
  | "enabled"
  | "running"
  | "disabled"
  | "crashed"
  | "removed";

export type PluginSource =
  | "local_file"
  | "git_url"
  | "registry"
  | "builtin"
  // Reported via the agent heartbeat for installs the operator made
  // directly from the agent webapp at port 8080 with no Convex row
  // backing them. Surfaces in the per-drone Plugins list with no
  // trust signals (signing context lives on the agent, not the GCS).
  | "agent_webapp";

/**
 * The well-known UI slots a plugin can mount into
 * (`product/specs/ados-plugin-platform/03-slot-verdicts.md`).
 * `node.detail.tab` is the per-node tab a plugin mounts on any node
 * profile (drone / ground-station / compute); `cockpit.panel` is the
 * in-`/fly` quick-settings surface; `flight.skill` is the cockpit Skill
 * Bar contribution. The first set is fleet-scoped; `node.detail.tab`,
 * `cockpit.panel`, and `flight.skill` are per-drone scoped and follow the
 * pause/resume + LRU lifecycle.
 *
 * Each slot id maps 1-to-1 to a `ui.slot.<kebab-id>` capability string
 * via `slotToCapability()` below.
 */
export const PLUGIN_SLOTS = [
  "fc.tab",
  "hardware.tab",
  "mission.template",
  "map.overlay",
  "video.overlay",
  "notification.channel",
  "settings.section",
  "node.detail.tab",
  "cockpit.panel",
  "flight.skill",
] as const;

export type PluginSlotName = (typeof PLUGIN_SLOTS)[number];

/**
 * Slots whose contribution is bound to the currently-selected drone and
 * is torn down + re-mounted when the operator switches between drones.
 * The host follows a 300 ms pause/resume grace period before unmounting
 * and enforces an LRU cap of 8 mounted iframes per drone-detail panel.
 * Plugins contributing to these slots receive a capability token whose
 * `agentId` claim matches the currently-selected drone; cross-drone RPCs
 * are rejected at the bridge layer.
 *
 * `node.detail.tab` stays first so the node-detail tab host can keep
 * resolving the canonical tab slot from `PER_DRONE_SLOTS[0]`. The last
 * entry, `flight.skill`, is a non-iframe per-drone slot: its contribution
 * is a Skill registered into the cockpit Skill Bar registry, keyed to the
 * active drone, with no iframe of its own.
 */
export const PER_DRONE_SLOTS: ReadonlyArray<PluginSlotName> = [
  "node.detail.tab",
  "cockpit.panel",
  "flight.skill",
] as const;

/** Convert a slot id ("fc.tab") to its capability string ("ui.slot.fc-tab"). */
export function slotToCapability(slot: PluginSlotName): string {
  return `ui.slot.${slot.replace(/\./g, "-")}`;
}

export function isPerDroneSlot(slot: PluginSlotName): boolean {
  return PER_DRONE_SLOTS.includes(slot);
}

/**
 * RPC envelope on the postMessage bridge. Every message between host
 * and iframe carries this shape; the bridge rejects anything that
 * does not validate.
 */
export interface PluginRpcEnvelope {
  /** Correlates request with response. */
  id: string;
  type: "request" | "response" | "event";
  method: string;
  /** Capability the caller claims it is exercising. */
  capability: string;
  args: unknown;
  /** Protocol version, currently 1. */
  version: 1;
  /** Present on responses only; absent on requests/events. */
  error?: { code: string; message: string };
  /**
   * Per-RPC capability token, base64-encoded JSON-claim format. Required
   * when the bridge is constructed with a token validator; the validator
   * checks expiry, plugin id, agent id, capability membership, and
   * signature against the right issuer secret. Optional when the bridge
   * runs without a validator (legacy hosts and unit tests).
   */
  token?: string;
}

/** Strong type for the response variant. */
export interface PluginRpcResponse extends PluginRpcEnvelope {
  type: "response";
  result?: unknown;
}

/**
 * Capability identifiers known to the GCS host.
 *
 * Derived from the generated catalog rather than hand-written. The
 * hand-maintained union this replaced had drifted from
 * `gcs-capabilities.generated.ts` in both directions: it listed `event.*`
 * capabilities the catalog did not have (so a manifest declaring one
 * type-checked here and was rejected by `isKnownGcsCapability` and by the
 * agent-side validator) and omitted `mcp.expose` (so a manifest legitimately
 * declaring it failed the typed check). Both event capabilities are now in
 * the catalog, where the GCS event-bus handlers already assumed they were.
 *
 * The `ui.slot.*` template literal is gone with the drift: every slot the
 * host can actually mount is enumerated in the catalog, and an open template
 * let a plugin declare a slot no registry had — which parsed everywhere and
 * then silently never rendered.
 */
export type PluginCapability = GcsCapability;

/**
 * Capability token shape held by the host. Plugin code never sees the
 * full token. The bridge attaches the signed `value` internally.
 */
export interface CapabilityToken {
  pluginId: string;
  sessionId: string;
  grantedCaps: ReadonlyArray<string>;
  issuedAt: number;
  expiresAt: number;
  value: string;
}

export interface PluginInstallSummary {
  pluginId: string;
  version: string;
  name: string;
  source: PluginSource;
  signerId?: string;
  status: PluginInstallStatus;
  halves: PluginHalf[];
}

/** Node profiles a plugin agent half can target. Mirrors the Pydantic
 * `Literal["drone", "ground-station", "workstation"]` on the agent side.
 * Older manifests that omit `agent.target_profiles` default to `["drone"]`
 * during agent-side parsing, so a missing field on the GCS-side wire
 * shape is also treated as drone-only. */
export type PluginTargetProfile = "drone" | "ground-station" | "workstation";

/** The resolved profile of a paired node. One vocabulary with
 * {@link PluginTargetProfile} across the stack — a node runs one of these
 * profiles and a plugin declares which of them it targets. */
export type PairedNodeProfile = PluginTargetProfile;

/**
 * Return true when a plugin advertising `targetProfiles` is compatible
 * with a paired node whose resolved profile is `nodeProfile`. The
 * agent applies the default of `["drone"]` for older manifests at
 * parse time, so callers should pass through `undefined`/`null` for
 * legacy installs and rely on this helper to apply the same default:
 * a drone-only plugin still does not match a ground-station or
 * workstation node.
 */
export function pluginMatchesProfile(
  targetProfiles: ReadonlyArray<PluginTargetProfile> | undefined | null,
  nodeProfile: PairedNodeProfile,
): boolean {
  const list: ReadonlyArray<PluginTargetProfile> =
    targetProfiles && targetProfiles.length > 0 ? targetProfiles : ["drone"];
  return list.includes(nodeProfile);
}
