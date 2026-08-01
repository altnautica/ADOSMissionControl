/**
 * Whether a vehicle can be commanded to navigate on its own.
 *
 * This gate decides whether the skill bar offers return-to-home, land, take
 * off, pause and resume. It used to read the geofence capability as a stand-in,
 * which tied those skills to an unrelated feature: a firmware could advertise
 * a geofence, have the skills enabled, and refuse every navigation command it
 * was given — the operator confirms a return-to-home and nothing happens. The
 * flag it reads now is the one that means it, and the commands behind it are
 * implemented for every firmware that sets it.
 *
 * Whether a particular aircraft can act on the command right now — the switch
 * assigned, the mission loaded — is the command's own answer, not this gate's.
 *
 * It lives apart from both context builders because both of them use it and
 * they already import from each other.
 *
 * @module skills/autonomous-nav
 * @license GPL-3.0-only
 */

import type { ProtocolCapabilities } from "@/lib/protocol/types";

import type { AutonomousNavCapability } from "./types";

/**
 * Read the autonomous-navigation capability from a capability set.
 *
 * No capabilities at all is "unknown", never "unsupported": a vehicle that has
 * not handshaken yet keeps its skills rather than losing them to a guess.
 */
export function autonomousNavFromCapabilities(
  capabilities: ProtocolCapabilities | null | undefined,
): AutonomousNavCapability {
  if (!capabilities) return "unknown";
  return capabilities.supportsAutonomousNav ? "supported" : "unsupported";
}
