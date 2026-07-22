/**
 * @module agent/network-client
 * @description Typed client for the agent's profile-agnostic Wi-Fi client
 * surface (`/api/v1/network/client/*`): live station status, saved profiles,
 * scan, join / leave / forget and the saved-profile autoconnect toggle.
 * These routes are served on every profile (joining a bench network only
 * needs a wlan interface), unlike the ground-station-scoped uplink matrix.
 *
 * Error surface: non-2xx responses throw {@link AgentNetworkError} carrying
 * the HTTP status plus the agent's own error code / message when the body
 * carries the `{detail: {error: {code, message}}}` envelope, and the
 * `needsForce` flag for the join-refused-while-AP-active conflict so the
 * caller can offer an explicit force-join instead of a dead error.
 * @license GPL-3.0-only
 */

export interface AgentRequestContext {
  baseUrl: string;
  apiKey: string | null;
}

/** Build a request context from the live agent connection, if any. */
export function agentNetworkContext(
  agentUrl: string | null,
  apiKey: string | null,
): AgentRequestContext | null {
  if (!agentUrl) return null;
  return { baseUrl: agentUrl.replace(/\/+$/, ""), apiKey: apiKey ?? null };
}

export class AgentNetworkError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  /** True for the join conflict: the node's AP holds the Wi-Fi radio and the
   * join was refused without `force`. */
  public readonly needsForce: boolean;

  constructor(
    status: number,
    message: string,
    code: string | null = null,
    needsForce = false,
  ) {
    super(message);
    this.name = "AgentNetworkError";
    this.status = status;
    this.code = code;
    this.needsForce = needsForce;
  }
}

/** True when the agent (or its proxy edge) does not expose the route at all
 * — a 404/501 from a build without the feature, as opposed to a failed
 * operation. Callers render "not exposed by this agent version". */
export function isRouteUnexposed(err: unknown): boolean {
  return (
    err instanceof AgentNetworkError &&
    (err.status === 404 || err.status === 501)
  );
}

/** Pull the agent's own error code + message out of an error body. Handles
 * the `{detail: {error: {code, message}}}` envelope, a plain-string
 * `detail`, and a flat `{error}`. */
function parseErrorBody(
  body: unknown,
): { code: string | null; message: string | null; needsForce: boolean } {
  let code: string | null = null;
  let message: string | null = null;
  let needsForce = false;
  if (body && typeof body === "object") {
    const row = body as Record<string, unknown>;
    if (row.needs_force === true) needsForce = true;
    const detail = row.detail;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object") {
      const err = (detail as Record<string, unknown>).error;
      if (err && typeof err === "object") {
        const e = err as Record<string, unknown>;
        if (typeof e.code === "string") code = e.code;
        if (typeof e.message === "string") message = e.message;
      }
    }
    if (message === null && typeof row.error === "string") message = row.error;
  }
  return { code, message, needsForce };
}

async function request<T>(
  ctx: AgentRequestContext,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (ctx.apiKey) headers["X-ADOS-Key"] = ctx.apiKey;
  const res = await fetch(`${ctx.baseUrl}${path}`, { ...init, headers });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const { code, message, needsForce } = parseErrorBody(json);
    throw new AgentNetworkError(
      res.status,
      message ?? `Agent API ${res.status}: ${text || "Unknown error"}`,
      code,
      needsForce,
    );
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Shapes (the agent's route bodies; every unknown stays null, never guessed).
// ---------------------------------------------------------------------------

export interface WifiClientLiveStatus {
  connected: boolean;
  ssid: string | null;
  bssid: string | null;
  /** nmcli signal strength, 0–100. */
  signal: number | null;
  ip: string | null;
  gateway: string | null;
  security: string | null;
}

export interface SavedWifiConnection {
  name: string;
  type: string;
  device: string | null;
  autoconnect: boolean;
}

export interface WifiScanNetwork {
  ssid: string;
  bssid: string;
  /** nmcli signal strength, 0–100. */
  signal: number;
  security: string;
  in_use?: boolean;
}

export interface WifiJoinOutcome {
  joined: boolean;
  ip?: string | null;
  gateway?: string | null;
  error?: string | null;
}

export interface WifiLeaveOutcome {
  left?: boolean;
  previous_ssid?: string | null;
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/** Live station connection state. `connected: false` with every field null is
 * also what an agent whose Wi-Fi manager is unreachable reports — the shape
 * does not distinguish, so render it as "no connection reported". */
export async function getWifiStatus(
  ctx: AgentRequestContext,
): Promise<WifiClientLiveStatus> {
  const raw = await request<Record<string, unknown>>(
    ctx,
    "/api/v1/network/client/status",
  );
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  const num = (k: string) => (typeof raw[k] === "number" ? (raw[k] as number) : null);
  return {
    connected: raw.connected === true,
    ssid: str("ssid"),
    bssid: str("bssid"),
    signal: num("signal"),
    ip: str("ip"),
    gateway: str("gateway"),
    security: str("security"),
  };
}

/** Saved NetworkManager Wi-Fi profiles. */
export async function getConfiguredWifi(
  ctx: AgentRequestContext,
): Promise<SavedWifiConnection[]> {
  const raw = await request<{ connections?: unknown }>(
    ctx,
    "/api/v1/network/client/configured",
  );
  if (!Array.isArray(raw.connections)) return [];
  const out: SavedWifiConnection[] = [];
  for (const row of raw.connections) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.name !== "string" || r.name.length === 0) continue;
    out.push({
      name: r.name,
      type: typeof r.type === "string" ? r.type : "",
      device: typeof r.device === "string" ? r.device : null,
      autoconnect: r.autoconnect === true,
    });
  }
  return out;
}

/** Scan nearby networks. Sorted by signal descending by the agent. Throws
 * {@link AgentNetworkError}; use {@link isRouteUnexposed} to tell "this agent
 * build does not expose scanning" apart from a failed scan. */
export async function scanWifi(
  ctx: AgentRequestContext,
): Promise<WifiScanNetwork[]> {
  const raw = await request<{ networks?: unknown }>(
    ctx,
    "/api/v1/network/client/scan",
  );
  if (!Array.isArray(raw.networks)) return [];
  const out: WifiScanNetwork[] = [];
  for (const row of raw.networks) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.ssid !== "string" || r.ssid.length === 0) continue;
    out.push({
      ssid: r.ssid,
      bssid: typeof r.bssid === "string" ? r.bssid : "",
      signal: typeof r.signal === "number" ? r.signal : 0,
      security: typeof r.security === "string" ? r.security : "",
      in_use: r.in_use === true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

/** Join a Wi-Fi network. The passphrase is sent to the node and never stored
 * or echoed back — the status route reports the joined SSID only. A join
 * refused because the node's AP holds the radio throws with
 * `needsForce: true` so the caller can confirm an explicit force-join. */
export async function joinWifi(
  ctx: AgentRequestContext,
  req: { ssid: string; passphrase?: string; force?: boolean },
): Promise<WifiJoinOutcome> {
  const body: Record<string, unknown> = { ssid: req.ssid };
  if (req.passphrase !== undefined && req.passphrase.length > 0) {
    body.passphrase = req.passphrase;
  }
  if (req.force) body.force = true;
  const raw = await request<Record<string, unknown>>(
    ctx,
    "/api/v1/network/client/join",
    { method: "PUT", body: JSON.stringify(body) },
  );
  return {
    joined: raw.joined === true,
    ip: typeof raw.ip === "string" ? raw.ip : null,
    gateway: typeof raw.gateway === "string" ? raw.gateway : null,
    error: typeof raw.error === "string" ? raw.error : null,
  };
}

/** Disconnect the current Wi-Fi-client link. */
export async function leaveWifi(
  ctx: AgentRequestContext,
): Promise<WifiLeaveOutcome> {
  const raw = await request<Record<string, unknown>>(
    ctx,
    "/api/v1/network/client",
    { method: "DELETE" },
  );
  return {
    left: raw.left === true,
    previous_ssid:
      typeof raw.previous_ssid === "string" ? raw.previous_ssid : null,
  };
}

/** Forget a saved profile by name. */
export async function forgetWifi(
  ctx: AgentRequestContext,
  name: string,
): Promise<void> {
  await request<Record<string, unknown>>(
    ctx,
    `/api/v1/network/client/configured/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}

/** Toggle a saved profile's autoconnect flag. */
export async function setWifiAutoconnect(
  ctx: AgentRequestContext,
  name: string,
  enabled: boolean,
): Promise<void> {
  await request<Record<string, unknown>>(
    ctx,
    `/api/v1/network/client/configured/${encodeURIComponent(name)}/autoconnect`,
    { method: "PUT", body: JSON.stringify({ enabled }) },
  );
}
