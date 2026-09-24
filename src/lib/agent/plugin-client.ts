/**
 * @module PluginClient
 * @description Client for the agent's plugin lifecycle endpoints
 * (`/api/plugins/*`). Wraps multipart upload for `/install` and the
 * grant / enable / disable / remove lifecycle calls, plus the reads an
 * inline GCS module is loaded and served through (attestation, manifest,
 * `gcs/` assets, the plugin's own HTTP passthrough).
 *
 * The agent returns a structured error envelope on failure:
 *   `{ ok: false, code: number, kind: string, detail: string }`
 *
 * The client surfaces errors as `PluginAgentError` so callers can
 * branch on `code` (which matches the CLI exit-code taxonomy).
 *
 * @license GPL-3.0-only
 */

import { timedFetch } from "@/lib/agent/agent-client/timeout";
import {
  WS_TICKET_PROTOCOL,
  mintWsTicket,
  pluginHttpTicketScope,
} from "@/lib/api/ground-station/ws-ticket";
import { parseInlineAttestation, type InlineAttestation } from "@/lib/plugins/inline-trust";
import type {
  PluginAgentInstallSummary,
  PluginAgentManifestDetail,
  PluginAgentParseSummary,
  PluginStateResponse,
} from "./plugin-client-types";

/**
 * Deadline for the plugin calls that move bulk bytes: two multipart
 * uploads of a `.adosplug` over what may be a radio link, one where the
 * AGENT does the download, and the plugin's own HTTP passthrough. The default
 * 6 s read deadline would abort a legitimate transfer of a few MB; these
 * still need a bound, because unbounded they hold a socket from Chromium's
 * 6-per-origin pool forever.
 */
const PLUGIN_TRANSFER_TIMEOUT_MS = 120_000;

/** How the client reaches the agent: `timedFetch` straight at the base URL,
 * or a same-origin proxy hop when an HTTPS page cannot reach a plain-HTTP
 * LAN node. Called with the full agent URL the client composed. */
export type AgentFetch = (
  url: string,
  init: RequestInit | undefined,
  timeoutMs?: number,
) => Promise<Response>;

/** Narrow an unknown response body to the sidecar shape: a plain object whose
 * values each carry a `payload` and a numeric `ts_ms`. */
export function isPluginStateResponse(body: unknown): body is PluginStateResponse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  for (const value of Object.values(body as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) return false;
    const entry = value as Record<string, unknown>;
    if (!("payload" in entry)) return false;
    if (typeof entry.ts_ms !== "number") return false;
  }
  return true;
}

/** Split a passthrough path into its path (no leading slash) and its query
 * suffix (`?a=b`, or empty). */
function splitPluginPath(path: string): [string, string] {
  const i = path.indexOf("?");
  const pathPart = (i < 0 ? path : path.slice(0, i)).replace(/^\/+/, "");
  return [pathPart, i < 0 ? "" : path.slice(i)];
}

export class PluginAgentError extends Error {
  readonly code: number;
  readonly kind: string;
  constructor(code: number, kind: string, detail: string) {
    super(detail || kind);
    this.code = code;
    this.kind = kind;
  }
}

export class PluginAgentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: AgentFetch;

  constructor(baseUrl: string, apiKey = "", fetchImpl: AgentFetch = timedFetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  private authHeader(): Record<string, string> {
    return this.apiKey ? { "X-ADOS-Key": this.apiKey } : {};
  }

  /** `/api/plugins/{id}` plus an optional sub-path whose segments are
   * percent-encoded one by one. */
  private pluginUrl(pluginId: string, sub = ""): string {
    const encoded = sub
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}${sub ? `/${encoded}` : ""}`;
  }

  async list(): Promise<{ installs: PluginAgentManifestDetail["install"][] }> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/plugins`, {
      headers: this.authHeader(),
    });
    return this.parse<{ installs: PluginAgentManifestDetail["install"][] }>(res);
  }

  async get(pluginId: string): Promise<PluginAgentManifestDetail> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId), {
      headers: this.authHeader(),
    });
    return this.parse<PluginAgentManifestDetail>(res);
  }

  /**
   * Fetch a plugin's GCS bundle file straight from the agent over the
   * LAN, so the GCS half mounts with no cloud. `entrypoint` is the
   * manifest's `gcs.entrypoint` (relative to the archive root, e.g.
   * `gcs/plugin.bundle.js`); the agent serves it under the plugin's
   * `gcs/` dir. Returns the raw bundle text (an ESM module).
   */
  async getGcsBundle(pluginId: string, entrypoint: string): Promise<string> {
    return new TextDecoder().decode(
      await this.getGcsAsset(pluginId, entrypoint.replace(/^gcs\//, "")),
    );
  }

  /** Raw bytes of one file under the plugin's `gcs/` dir (`path` relative
   * to it). */
  async getGcsAsset(
    pluginId: string,
    path: string,
    init?: { signal?: AbortSignal },
  ): Promise<ArrayBuffer> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, `gcs/${path}`), {
      headers: this.authHeader(),
      signal: init?.signal,
    });
    if (!res.ok) {
      throw new PluginAgentError(res.status, "gcs_asset", `gcs asset fetch failed: HTTP ${res.status}`);
    }
    return res.arrayBuffer();
  }

  /** The installed plugin's signature and file digests. */
  async getAttestation(
    pluginId: string,
    init?: { signal?: AbortSignal },
  ): Promise<InlineAttestation> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, "attestation"), {
      headers: this.authHeader(),
      signal: init?.signal,
    });
    return parseInlineAttestation(await this.parse<unknown>(res));
  }

  /** The installed `manifest.yaml`, byte for byte. */
  async getManifestBytes(
    pluginId: string,
    init?: { signal?: AbortSignal },
  ): Promise<Uint8Array> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, "manifest"), {
      headers: this.authHeader(),
      signal: init?.signal,
    });
    if (!res.ok) {
      throw new PluginAgentError(res.status, "manifest", `manifest fetch failed: HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * One request to the plugin's own HTTP server through the agent passthrough
   * (`/api/plugins/{id}/x/<path>`). `path` may carry a query string. The raw
   * response is returned for the caller to read.
   */
  async pluginHttp(pluginId: string, path: string, init: RequestInit = {}): Promise<Response> {
    const [pathPart, query] = splitPluginPath(path);
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(this.authHeader())) headers.set(k, v);
    return this.fetchImpl(
      `${this.pluginUrl(pluginId, `x/${pathPart}`)}${query}`,
      { ...init, headers },
      PLUGIN_TRANSFER_TIMEOUT_MS,
    );
  }

  /**
   * Open a WebSocket to the plugin's own HTTP server through the agent
   * passthrough. A browser cannot send the pairing key on a handshake, so a
   * one-shot ticket scoped to this plugin rides the subprotocol list.
   */
  async openPluginSocket(pluginId: string, path: string): Promise<WebSocket> {
    const ticket = await mintWsTicket(
      { baseUrl: this.baseUrl, apiKey: this.apiKey || null },
      pluginHttpTicketScope(pluginId),
    );
    const [pathPart, query] = splitPluginPath(path);
    const url = `${this.pluginUrl(pluginId, `x/${pathPart}`)}${query}`.replace(/^http/, "ws");
    return ticket ? new WebSocket(url, [WS_TICKET_PROTOCOL, ticket]) : new WebSocket(url);
  }

  /**
   * Read a plugin's latest published state from the agent over the LAN.
   * The agent's plugin host writes the latest event per topic a plugin
   * publishes into a state sidecar; `GET /api/plugins/{id}/state` returns
   * it as `{ "<topic>": { payload, ts_ms } }`. Resolves `null` when the
   * agent has no fresh state for the plugin (`404` — the plugin has not
   * published, is not running, or its state went stale), so a poller can
   * skip it without treating it as an error. Other transport failures
   * also resolve `null` rather than throwing, so a poll loop never breaks
   * on a single bad read.
   */
  async getState(pluginId: string): Promise<PluginStateResponse | null> {
    const body = await this.getRawState(pluginId);
    return body !== null && isPluginStateResponse(body) ? body : null;
  }

  /**
   * Read a plugin / first-party service's state sidecar as a RAW object,
   * without the topic-map (`{ topic: { payload, ts_ms } }`) shape `getState`
   * enforces. A first-party service writes a FLAT slice (`{ state,
   * sessionId, ... }`) to the same `GET /api/plugins/{id}/state` route, which
   * `getState` would reject. This returns any JSON object verbatim, or `null`
   * on `404` / non-object / transport failure, so a local-first poll never
   * throws.
   */
  async getRawState(pluginId: string): Promise<Record<string, unknown> | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.pluginUrl(pluginId, "state"), {
        headers: this.authHeader(),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    try {
      const body = (await res.json()) as unknown;
      return typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Validate the archive without committing the install. Used by
   * the install dialog to render the manifest preview before the
   * operator approves permissions.
   */
  async parseArchive(file: File): Promise<PluginAgentParseSummary> {
    const form = new FormData();
    form.append("file", file);
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/plugins/parse`,
      { method: "POST", headers: this.authHeader(), body: form },
      PLUGIN_TRANSFER_TIMEOUT_MS,
    );
    return this.parse<PluginAgentParseSummary>(res);
  }

  async install(file: File): Promise<PluginAgentInstallSummary> {
    const form = new FormData();
    form.append("file", file);
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/plugins/install`,
      { method: "POST", headers: this.authHeader(), body: form },
      PLUGIN_TRANSFER_TIMEOUT_MS,
    );
    return this.parse<PluginAgentInstallSummary>(res);
  }

  /**
   * Parse a `.adosplug` from an allowlisted URL WITHOUT installing it — the
   * agent fetches + signature-checks the archive and returns the manifest
   * summary, so the install dialog reviews permissions before consent for an
   * operator-supplied URL (the browser cannot fetch an arbitrary URL itself).
   */
  async parseFromUrl(
    url: string,
    expectedSha256 = "",
  ): Promise<PluginAgentParseSummary> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/plugins/parse_from_url`,
      {
        method: "POST",
        headers: { ...this.authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          ...(expectedSha256 ? { expected_sha256: expectedSha256 } : {}),
        }),
      },
      PLUGIN_TRANSFER_TIMEOUT_MS,
    );
    return this.parse<PluginAgentParseSummary>(res);
  }

  /**
   * Read a plugin's config as the plugin itself sees it on this drone (the
   * agent's native `GET /api/plugins/{id}/config`: global keys with the
   * drone's own keys over them).
   */
  async getConfig(pluginId: string): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, "config"), {
      method: "GET",
      headers: this.authHeader(),
    });
    const body = await this.parse<{ values?: unknown }>(res);
    const values = body.values;
    return values && typeof values === "object" && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : {};
  }

  /**
   * Write a plugin's per-drone config to the LIVE plugin host over the LAN
   * (the agent's native `PUT /api/plugins/{id}/config` → the on-box control
   * socket → the running daemon's config store). `value` is any JSON value
   * (a bool for a skill toggle, a number for a follow distance). `scope`
   * defaults to per-drone on the agent. Returns the agent's `{set, scope}`.
   *
   * This is the local-first config-write path: it reaches the agent
   * directly with the stored pairing key, no Convex round-trip. The cloud
   * mirror (cmd_droneCommands) is a separate, later path.
   */
  async setConfig(
    pluginId: string,
    key: string,
    value: unknown,
    scope?: "drone" | "global",
  ): Promise<{ set: boolean; scope: string | null }> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, "config"), {
      method: "PUT",
      headers: { ...this.authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(scope ? { key, value, scope } : { key, value }),
    });
    return this.parse<{ set: boolean; scope: string | null }>(res);
  }

  async grant(pluginId: string, permissionId: string): Promise<void> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, "grant"), {
      method: "POST",
      headers: { ...this.authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ permission_id: permissionId }),
    });
    await this.parse(res);
  }

  /**
   * Revoke a previously-granted permission on the agent. Returns the
   * remaining granted-permission set so callers can reconcile UI state
   * without a follow-up GET. The agent's `requires_restart` flag is
   * dropped here; the GCS treats every revoke as a soft hint and
   * surfaces a restart toast separately when the operator chooses.
   */
  async revoke(
    pluginId: string,
    permissionId: string,
  ): Promise<{ granted: string[] }> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, `perms/${permissionId}`), {
      method: "DELETE",
      headers: this.authHeader(),
    });
    const body = await this.parse<{
      ok: true;
      plugin_id: string;
      granted: string[];
      requires_restart?: boolean;
    }>(res);
    return { granted: Array.isArray(body.granted) ? body.granted : [] };
  }

  async enable(pluginId: string): Promise<void> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, "enable"), {
      method: "POST",
      headers: this.authHeader(),
    });
    await this.parse(res);
  }

  async disable(pluginId: string): Promise<void> {
    const res = await this.fetchImpl(this.pluginUrl(pluginId, "disable"), {
      method: "POST",
      headers: this.authHeader(),
    });
    await this.parse(res);
  }

  async remove(pluginId: string, opts?: { keepData?: boolean }): Promise<void> {
    const qs = opts?.keepData ? "?keep_data=1" : "";
    const res = await this.fetchImpl(`${this.pluginUrl(pluginId)}${qs}`, {
      method: "DELETE",
      headers: this.authHeader(),
    });
    await this.parse(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // fall through; treat as opaque failure
    }
    if (!res.ok) {
      if (
        body &&
        typeof body === "object" &&
        "ok" in body &&
        (body as { ok: unknown }).ok === false
      ) {
        const b = body as { code?: number; kind?: string; detail?: string };
        throw new PluginAgentError(
          typeof b.code === "number" ? b.code : 1,
          typeof b.kind === "string" ? b.kind : "unknown",
          typeof b.detail === "string" ? b.detail : `HTTP ${res.status}`,
        );
      }
      throw new PluginAgentError(1, "transport_error", `HTTP ${res.status}`);
    }
    return body as T;
  }
}
