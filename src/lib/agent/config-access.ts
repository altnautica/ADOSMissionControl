"use client";

/**
 * @module agent/config-access
 * @description The single shared resolution for "does this surface have a
 * working path to the focused node's agent, and over which transport?".
 *
 * Historically every config-adjacent surface re-derived its own
 * `cloudMode || !client` clamp, which conflated two different facts: the
 * session being in cloud mode, and there being no transport at all. Cloud
 * mode always detaches the direct client, but a node that was ever paired
 * over the LAN still has a stored host + pairing key — and the
 * `/api/lan-pair/config` proxy can carry the config surface to it from any
 * origin (the mixed-content hop happens server-side). So the truthful
 * resolution is four-way:
 *
 *  - `direct` — a live agent client is attached; call it.
 *  - `proxy`  — no client, but a pairing record names a LAN host; route
 *               the config read/write through the server-side proxy.
 *  - `relay`  — no client and no pairing record of its own, but the node is
 *               a drone reached through its ground station's WFB
 *               relay-proxy; route through the same server-side proxy with
 *               the ground station as the host and the drone's device id as
 *               the relay-proxy peer segment.
 *  - `none`   — genuinely no path (never paired, no ground station, or the
 *               record has no host); the surface is read-only and says why.
 *
 * Operations the proxy does not forward (camera roster, OTA, log
 * streaming) resolve through {@link hasClientPath} instead: they are
 * writable exactly when a direct client exists. The relay lane does NOT
 * change that answer — see the note on {@link hasClientPath}.
 *
 * @license GPL-3.0-only
 */

import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";
import type { RelayReach } from "@/lib/nodes/relay-reach";

/** Response shape of the agent's single-key config write. */
export interface ConfigWriteResult {
  status?: string;
  key?: string;
  value?: unknown;
  error?: string;
}

/** The slice of the agent client the config surface needs. Structural, so
 * tests (and any future transport) can satisfy it without the full client
 * class. */
export interface AgentConfigClient {
  getConfig(): Promise<Record<string, unknown>>;
  setConfigValue(key: string, value: string): Promise<ConfigWriteResult>;
}

/** A LAN target the server-side config proxy can reach on the operator's
 * behalf: the stored host (base URL, mDNS name, or IP) plus the pairing
 * key for that agent when one is stored. */
export interface ConfigProxyTarget {
  host: string;
  apiKey: string | null;
}

/** Why a surface resolved read-only. There is exactly one honest reason
 * today: no transport reaches the node at all. */
export type ConfigAccessReason = "no-path";

export type ConfigAccess =
  | { mode: "direct"; client: AgentConfigClient }
  | { mode: "proxy"; target: ConfigProxyTarget }
  | { mode: "relay"; reach: RelayReach }
  | { mode: "none"; reason: ConfigAccessReason };

/** The pairing records the proxy-target lookup searches. Callers that
 * already subscribe to the stores pass their reactive slices; imperative
 * callers omit the argument and the current store state is read. */
export interface PairingRecords {
  localNodes: readonly LocalNode[];
  pairedDrones: readonly PairedDrone[];
}

function currentRecords(): PairingRecords {
  return {
    localNodes: useLocalNodesStore.getState().nodes,
    pairedDrones: usePairingStore.getState().pairedDrones,
  };
}

/**
 * Find a proxy-reachable LAN target for `deviceId` from the pairing
 * records. Unlike the direct-fetch resolver in the connection store, this
 * does NOT null out on an HTTPS origin: the proxy exists precisely so an
 * HTTPS Mission Control can reach a plain-HTTP LAN agent. The browser-local
 * record wins (it is the LAN-pairing truth source); the cloud pairing
 * record is the fallback.
 */
export function resolveConfigProxyTarget(
  deviceId: string | null,
  records: PairingRecords = currentRecords(),
): ConfigProxyTarget | null {
  if (!deviceId) return null;
  const localNode = records.localNodes.find((n) => n.deviceId === deviceId);
  if (localNode) {
    const host = localNode.hostname || localNode.mdnsHost || localNode.ipv4;
    if (host) return { host, apiKey: localNode.apiKey ?? null };
  }
  const pairedDrone = records.pairedDrones.find(
    (d) => d.deviceId === deviceId,
  );
  if (pairedDrone) {
    const host = pairedDrone.mdnsHost || pairedDrone.lastIp;
    if (host) return { host, apiKey: pairedDrone.apiKey ?? null };
  }
  return null;
}

/**
 * Resolve the transport for the config surface.
 *
 * Resolution order is deliberate and load-bearing:
 *
 *  1. A live direct client wins. Local-first: it is the node's own API with
 *     no third node in the path. A drone that happens to ALSO be relayed
 *     must never be routed through its ground station's radio when it has
 *     its own direct path — that would add a lossy hop, halve the effective
 *     payload budget, and (on the relay's aux RPC lane) cap a response at a
 *     size a large config read can exceed.
 *  2. This node's OWN LAN pairing record. Still a single hop to the node
 *     itself, just via the server-side proxy so an HTTPS origin can reach a
 *     plain-HTTP LAN agent. Preferred over the relay for the same reason.
 *  3. The ground station's relay-proxy. Last, because it is the only lane
 *     that crosses a radio and depends on a THIRD node being reachable. A
 *     relayed drone has neither a direct client (an HTTPS origin cannot dial
 *     the ground station's plain-HTTP relay-proxy from the browser at all)
 *     nor a pairing record of its own — it has no IP address — so without
 *     this lane its entire settings surface resolves `none`.
 *  4. `none` — read-only, and the surface says why.
 *
 * `relayReach` is an optional trailing parameter so every existing call site
 * (which has no per-node fleet data to resolve a reach from) keeps its exact
 * shape and behaviour.
 */
export function resolveConfigAccess(
  client: AgentConfigClient | null | undefined,
  deviceId: string | null,
  records?: PairingRecords,
  relayReach?: RelayReach | null,
): ConfigAccess {
  if (client) return { mode: "direct", client };
  const target = resolveConfigProxyTarget(deviceId, records);
  if (target) return { mode: "proxy", target };
  if (relayReach) return { mode: "relay", reach: relayReach };
  return { mode: "none", reason: "no-path" };
}

/**
 * Whether an operation only the direct LAN client serves (camera roster,
 * OTA, log streaming — endpoints the config proxy does not forward) has a
 * working path. Cloud mode always sets the client to null, so the old
 * `cloudMode || !client` clamp collapses to this one check — kept here so
 * every surface derives the decision from the shared resolution instead
 * of re-deriving the pair. A future cloud transport that attaches a real
 * client makes these surfaces light up with no per-site change.
 *
 * The `relay` lane does NOT widen this, and the gate is unchanged on
 * purpose. Two independent reasons, both of which must hold for a surface
 * to ride a lane:
 *
 *  - The server-side `/api/lan-pair/config` route fixes its upstream path
 *    map server-side so it can never be steered at an arbitrary agent path.
 *    The camera roster (`/api/video/roster`) and OTA (`/api/ota`) are not in
 *    that map, and widening it to accept a caller-supplied path is exactly
 *    the property that map exists to protect.
 *  - Log streaming is an `EventSource` (a long-lived streaming GET). This
 *    route buffers the upstream with `response.text()` and answers once, and
 *    the relay is a fragmented request/response RPC over the aux radio lane —
 *    neither can hold a stream open. `LoggingService.tail` already refuses on
 *    `ctx.relay` for exactly this reason and drops its caller to polling.
 *
 * So on the relay lane those three surfaces genuinely have no path, and the
 * gate stays truthful by staying as it is.
 */
export function hasClientPath<T>(client: T | null | undefined): client is T {
  return client !== null && client !== undefined;
}

const NO_PATH_MESSAGE = "No connection path to this node";

/** The envelope the server-side route needs for a lane it carries on the
 * operator's behalf. `peerDeviceId` is present ONLY on the relay lane, where
 * the route composes
 * `/api/v1/ground-station/relay-proxy/<peerDeviceId>/api/config` from its own
 * fixed suffix — it is a lane discriminator as much as a value, so the LAN
 * lane must never carry the key and the relay lane must never omit it. */
interface ProxyEnvelope {
  target: ConfigProxyTarget;
  peerDeviceId?: string;
}

/** POST the envelope to the server-side config proxy and surface the
 * upstream response the way a direct `agentRequest` would: non-2xx throws
 * with the upstream message, a 2xx body is returned for the caller's own
 * `{error}` check. Identical on the LAN and relay lanes, so a 422 validation
 * message or an `{error}` payload from the drone reads the same either way. */
async function proxyConfigRequest(
  envelope: ProxyEnvelope,
  method: "GET" | "PUT" | "POST",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch("/api/lan-pair/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host: envelope.target.host,
      ...(envelope.target.apiKey ? { apiKey: envelope.target.apiKey } : {}),
      method,
      ...(envelope.peerDeviceId !== undefined
        ? { peerDeviceId: envelope.peerDeviceId }
        : {}),
      ...(body !== undefined ? { body } : {}),
    }),
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const row = (json ?? {}) as { message?: unknown; error?: unknown };
    const message =
      typeof row.message === "string"
        ? row.message
        : typeof row.error === "string"
          ? row.error
          : `Agent API ${res.status}: ${text || "Unknown error"}`;
    throw new Error(message);
  }
  return json;
}

/** The proxy envelope for a lane the server-side route carries, or null for
 * the two lanes it does not (`direct` calls the client; `none` has no path).
 * Keeping the mapping here is what makes the relay lane structurally unable
 * to send a LAN envelope: the ground station's host and the drone's peer
 * segment are filled from the same reach in one place. */
function proxyEnvelopeFor(access: ConfigAccess): ProxyEnvelope | null {
  if (access.mode === "proxy") return { target: access.target };
  if (access.mode === "relay") {
    return {
      target: { host: access.reach.baseUrl, apiKey: access.reach.apiKey },
      peerDeviceId: access.reach.peerDeviceId,
    };
  }
  return null;
}

/** Read the node's config over whichever transport resolved. Throws when
 * no path exists — callers gate on the access mode first. */
export async function getConfigViaAccess(
  access: ConfigAccess,
): Promise<Record<string, unknown>> {
  if (access.mode === "direct") return access.client.getConfig();
  const envelope = proxyEnvelopeFor(access);
  if (envelope) {
    const json = await proxyConfigRequest(envelope, "GET");
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return json as Record<string, unknown>;
    }
    throw new Error("Agent returned a malformed configuration payload");
  }
  throw new Error(NO_PATH_MESSAGE);
}

/** Write a single dot-path config key over whichever transport resolved.
 * Returns the agent's response body so callers keep their `{error}` check
 * and read-back-confirm loop identical across transports. */
export async function setConfigValueViaAccess(
  access: ConfigAccess,
  key: string,
  value: string,
): Promise<ConfigWriteResult> {
  if (access.mode === "direct") return access.client.setConfigValue(key, value);
  const envelope = proxyEnvelopeFor(access);
  if (envelope) {
    const json = await proxyConfigRequest(envelope, "PUT", { key, value });
    return (
      json && typeof json === "object" && !Array.isArray(json) ? json : {}
    ) as ConfigWriteResult;
  }
  throw new Error(NO_PATH_MESSAGE);
}
