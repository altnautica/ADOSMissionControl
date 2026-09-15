/**
 * @module AgentCapabilities/Derivers
 * @description Per-field forward-permissive parsers for the agent-capabilities
 * heartbeat payload. Each helper accepts the raw payload and returns one
 * normalized value (or `undefined` when the agent omits the field, so the
 * caller can keep the prior state).
 *
 * Split out from `./normalizer` to keep that file focused on shape mapping
 * (cameras, vision, models, radio) and this file focused on small literal
 * parsers. No Zustand access, no side effects.
 *
 * @license GPL-3.0-only
 */

import type {
  AgentProfile,
  AgentRole,
  ManualConnectionUrls,
  WfbFailoverState,
} from "./types";

// Module-scoped set of unknown profile strings we've already warned
// about. Prevents the heartbeat-rate console spam when a future agent
// advertises a profile the GCS doesn't know yet.
const _seenUnknownProfiles = new Set<string>();

/** Extract setup-wizard state. Accepts snake_case or camelCase. */
export function deriveSetupState(caps: unknown): string | undefined {
  const rawSetup =
    (caps as { setupState?: unknown }).setupState ??
    (caps as { setup_state?: unknown }).setup_state;
  return typeof rawSetup === "string" ? rawSetup : undefined;
}

/** Extract profile-source provenance. Accepts snake_case or camelCase. */
export function deriveProfileSource(caps: unknown): string | undefined {
  const rawProfileSource =
    (caps as { profileSource?: unknown }).profileSource ??
    (caps as { profile_source?: unknown }).profile_source;
  return typeof rawProfileSource === "string" ? rawProfileSource : undefined;
}

/**
 * Clamp the wire-level profile string onto the known set. Forward-compat:
 * an unknown profile clamps to "drone" and warns once per unique value to
 * avoid heartbeat-rate console spam.
 */
export function deriveProfile(caps: unknown): AgentProfile {
  const rawProfile =
    (caps as { profile?: unknown }).profile ??
    (caps as { node_profile?: unknown }).node_profile;
  // The agent heartbeat may send the ground-station profile in either the
  // hyphenated wire form or the underscored Python-symbol form; normalize
  // both to the canonical hyphenated value so the badge and tab gating fire.
  if (rawProfile === "ground-station" || rawProfile === "ground_station") {
    return "ground-station";
  }
  if (rawProfile === "workstation") {
    return rawProfile;
  }
  if (
    typeof rawProfile === "string" &&
    rawProfile !== "drone" &&
    typeof console !== "undefined" &&
    !_seenUnknownProfiles.has(rawProfile)
  ) {
    _seenUnknownProfiles.add(rawProfile);
    console.warn(
      "[agent-capabilities-store] unknown profile %s clamped to drone",
      rawProfile,
    );
  }
  return "drone";
}

/**
 * Pull the ground-station role from the payload. Returns undefined when the
 * agent omits the field entirely (older agents) so the merge step keeps the
 * prior value. Explicit null means "no role yet"; on drones the agent emits
 * null and we keep it null.
 *
 * `"unset"` is a real answer the ground-station REST contract defines — a box
 * that has been imaged but never had a role chosen. Dropping it here collapsed
 * it to `undefined`, which the merge reads as "keep prior", so a fresh ground
 * station resolved to role `null` forever and never reached the surface that
 * carries the "choose a role" guidance.
 */
export function deriveRole(caps: unknown): AgentRole | undefined {
  const rawRole = (caps as { role?: unknown }).role;
  if (
    rawRole === "direct" ||
    rawRole === "relay" ||
    rawRole === "receiver" ||
    rawRole === "unset"
  ) {
    return rawRole;
  }
  if (rawRole === null) return null;
  return undefined;
}

/** True when the value is a finite, non-negative integer count. */
function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Forward-permissive: undefined means "keep prior", a non-int means undefined. */
export function deriveVideoRestartAttempts(
  caps: unknown,
): number | undefined {
  const raw = (caps as { videoRestartAttempts?: unknown }).videoRestartAttempts;
  return isCount(raw) ? Math.floor(raw) : undefined;
}

/** Forward-permissive: undefined keeps prior, null explicitly clears. */
export function derivePairingCodeExpiresAt(
  caps: unknown,
): number | null | undefined {
  const raw = (caps as { pairingCodeExpiresAt?: unknown }).pairingCodeExpiresAt;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (raw === null) return null;
  return undefined;
}

export function deriveMavlinkWsUrlPrev(
  caps: unknown,
): string | null | undefined {
  const raw = (caps as { mavlinkWsUrlPrev?: unknown }).mavlinkWsUrlPrev;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (raw === null) return null;
  return undefined;
}

/**
 * Manual-connection URL block. Forward-permissive: undefined keeps the
 * prior value, a partial block is accepted as-is so the GCS can render
 * whichever fallbacks the agent currently advertises.
 */
export function deriveManualConnectionUrls(
  caps: unknown,
): ManualConnectionUrls | null | undefined {
  const raw = (caps as { manualConnectionUrls?: unknown }).manualConnectionUrls;
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  const pick = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    mavlinkTcp: pick(m.mavlinkTcp),
    mavlinkWs: pick(m.mavlinkWs),
    videoViewer: pick(m.videoViewer),
    videoWhep: pick(m.videoWhep),
  };
}

export function deriveCloudRelayUrl(caps: unknown): string | null | undefined {
  const raw = (caps as { cloudRelayUrl?: unknown }).cloudRelayUrl;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (raw === null) return null;
  return undefined;
}

export function deriveCloudflareUrl(caps: unknown): string | null | undefined {
  const raw = (caps as { cloudflareUrl?: unknown }).cloudflareUrl;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (raw === null) return null;
  return undefined;
}

/**
 * Forward-permissive: undefined keeps prior, a known string sets it, anything
 * else clamps to "local" so an agent shipping a future variant can't put the
 * UI into an invalid state.
 */
export function deriveWfbFailoverState(
  caps: unknown,
): WfbFailoverState | undefined {
  const raw = (caps as { wfbFailoverState?: unknown }).wfbFailoverState;
  if (raw === undefined) return undefined;
  if (raw === "local" || raw === "cloud_relay" || raw === "failed") return raw;
  return "local";
}
