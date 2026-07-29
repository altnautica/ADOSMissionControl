/**
 * @module ResolveLanUrl
 * @description Local copy of the LAN URL resolver used by the plugin
 * install dialog. Mirrors the resolver in
 * `src/stores/agent-connection/cloud-state.ts` exactly; duplicated here
 * to avoid reaching into another domain's store internals from the
 * dialog. Keep the two in sync if either changes.
 *
 * On HTTPS origins the browser blocks plain-HTTP fetches to a private
 * LAN host (mixed content). Returning `null` here lets the cloud-relay
 * path take over cleanly rather than the dialog surfacing a "Failed to
 * fetch" against a doomed direct call.
 *
 * Also returns the paired API key so the dialog can stamp the
 * `X-ADOS-Key` header without prompting.
 *
 * Alongside the LAN resolver, `resolveRelayTarget` resolves the same
 * shape for a drone reached only through a ground station's WFB relay —
 * the fallback the install dialog tries once `resolveLanTarget` returns
 * null. It reuses the proven `resolveRelayReach` pattern from
 * `src/lib/nodes/relay-reach.ts` (the same one `agent-client/client.ts`,
 * `config-access.ts`, and `logging.ts` already build their relay-aware
 * clients from).
 *
 * @license GPL-3.0-only
 */

import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { nodeIdForDevice } from "@/lib/agent/node-id";
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

export function resolveLanTarget(deviceId: string): LanTarget | null {
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:"
  ) {
    return null;
  }
  const url = pickUrl(deviceId);
  const apiKey = pickKey(deviceId);
  if (!url || !apiKey) return null;
  return { url, apiKey };
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

function pickUrl(deviceId: string): string | null {
  const localNode = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.deviceId === deviceId);
  if (localNode) {
    if (localNode.hostname) return localNode.hostname;
    const host = localNode.mdnsHost || localNode.ipv4;
    if (host) return `http://${host}:8080`;
  }
  const pairedDrone = usePairingStore
    .getState()
    .pairedDrones.find((d) => d.deviceId === deviceId);
  if (pairedDrone) {
    const host = pairedDrone.mdnsHost || pairedDrone.lastIp;
    if (host) return `http://${host}:8080`;
  }
  return null;
}

function pickKey(deviceId: string): string | null {
  const localNode = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.deviceId === deviceId);
  if (localNode?.apiKey) return localNode.apiKey;
  const pairedDrone = usePairingStore
    .getState()
    .pairedDrones.find((d) => d.deviceId === deviceId);
  return pairedDrone?.apiKey ?? null;
}
