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
 * resolution is three-way:
 *
 *  - `direct` — a live agent client is attached; call it.
 *  - `proxy`  — no client, but a pairing record names a LAN host; route
 *               the config read/write through the server-side proxy.
 *  - `none`   — genuinely no path (never paired, or the record has no
 *               host); the surface is read-only and says why.
 *
 * Operations the proxy does not forward (camera roster, OTA, log
 * streaming) resolve through {@link hasClientPath} instead: they are
 * writable exactly when a direct client exists.
 *
 * @license GPL-3.0-only
 */

import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";

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
 * Resolve the transport for the config surface: the direct client when
 * one is attached, the server-side proxy when a pairing record names a
 * host, read-only (`none`) only when there is genuinely no path.
 */
export function resolveConfigAccess(
  client: AgentConfigClient | null | undefined,
  deviceId: string | null,
  records?: PairingRecords,
): ConfigAccess {
  if (client) return { mode: "direct", client };
  const target = resolveConfigProxyTarget(deviceId, records);
  if (target) return { mode: "proxy", target };
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
 */
export function hasClientPath<T>(client: T | null | undefined): client is T {
  return client !== null && client !== undefined;
}

const NO_PATH_MESSAGE = "No connection path to this node";

/** POST the envelope to the server-side config proxy and surface the
 * upstream response the way a direct `agentRequest` would: non-2xx throws
 * with the upstream message, a 2xx body is returned for the caller's own
 * `{error}` check. */
async function proxyConfigRequest(
  target: ConfigProxyTarget,
  method: "GET" | "PUT" | "POST",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch("/api/lan-pair/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host: target.host,
      ...(target.apiKey ? { apiKey: target.apiKey } : {}),
      method,
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

/** Read the node's config over whichever transport resolved. Throws when
 * no path exists — callers gate on the access mode first. */
export async function getConfigViaAccess(
  access: ConfigAccess,
): Promise<Record<string, unknown>> {
  if (access.mode === "direct") return access.client.getConfig();
  if (access.mode === "proxy") {
    const json = await proxyConfigRequest(access.target, "GET");
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
  if (access.mode === "proxy") {
    const json = await proxyConfigRequest(access.target, "PUT", { key, value });
    return (
      json && typeof json === "object" && !Array.isArray(json) ? json : {}
    ) as ConfigWriteResult;
  }
  throw new Error(NO_PATH_MESSAGE);
}
