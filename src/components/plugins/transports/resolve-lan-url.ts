/**
 * @module ResolveLanUrl
 * @description Install-dialog transport targets. The LAN target comes from
 * the shared plugin reach resolver (`resolveLanAgent` in
 * `lib/agent/resolve-agent.ts`); `resolveRelayTarget` resolves the same shape
 * for a drone reached only through a ground station's WFB relay — the
 * fallback the install dialog tries once the LAN resolver returns null. It
 * reuses the `resolveRelayReach` pattern from `src/lib/nodes/relay-reach.ts`
 * (the same one `agent-client/client.ts`, `config-access.ts`, and
 * `logging.ts` build their relay-aware clients from).
 *
 * @license GPL-3.0-only
 */

import { useNodeRegistryStore } from "@/stores/node-registry";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { resolveLanAgent } from "@/lib/agent/resolve-agent";
import { relayProxyBaseUrl, resolveRelayReach } from "@/lib/nodes/relay-reach";

export interface LanTarget {
  url: string;
  apiKey: string;
}

/** Same shape as {@link LanTarget}, tagged so callers can branch on the
 * transport without re-deriving it — the install dialog routes a `relay`
 * hit to the URL-based installer only, never the archive-upload one. */
export interface RelayTarget extends LanTarget {
  relay: true;
}

/** The drone's own LAN install target, or null when it has no LAN reach
 *  (HTTPS origin, unpaired, or no known host). */
export function resolveLanTarget(deviceId: string): LanTarget | null {
  const agent = resolveLanAgent(deviceId);
  return agent ? { url: agent.agentUrl, apiKey: agent.apiKey } : null;
}

/**
 * Resolve the relay-proxy target for a drone that has no LAN reach of its
 * own but hangs off a ground station's WFB radio relay. Null when the
 * drone is not relayed, its ground station is unknown, or that ground
 * station is not itself LAN-paired on this browser — the same
 * null-on-no-match convention as {@link resolveLanTarget}.
 *
 * Callers try `resolveLanTarget` first; this is the fallback, so
 * `agentDeviceId` is always passed as `null` here — a direct LAN hit
 * already returned above and never reaches this resolver.
 */
export function resolveRelayTarget(deviceId: string): RelayTarget | null {
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:"
  ) {
    // The relay-proxy route lives at the ground station's plain-HTTP LAN
    // address, so an HTTPS page origin blocks it as mixed content before
    // a single request leaves the browser (see node-click-handler.ts).
    return null;
  }
  const entry = useNodeRegistryStore.getState().getEntry(nodeIdForDevice(deviceId));
  const reach = resolveRelayReach({
    agentDeviceId: null,
    reachedVia: entry?.presence.reachedVia,
    droneDeviceId: deviceId,
  });
  if (!reach) return null;
  return { url: relayProxyBaseUrl(reach), apiKey: reach.apiKey, relay: true };
}
