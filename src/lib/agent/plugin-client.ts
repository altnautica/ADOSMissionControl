/**
 * @module PluginClient
 * @description Client for the agent's plugin lifecycle endpoints
 * (`/api/plugins/*`). Wraps multipart upload for `/install` and the
 * grant / enable / disable / remove lifecycle calls.
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

/**
 * Deadline for the three plugin calls that move an archive: two multipart
 * uploads of a `.adosplug` over what may be a radio link, and one where the
 * AGENT does the download. The default 6 s read deadline would abort a
 * legitimate install of a few MB; these still need a bound, because
 * unbounded they hold a socket from Chromium's 6-per-origin pool forever.
 */
const PLUGIN_TRANSFER_TIMEOUT_MS = 120_000;

export interface PluginAgentInstallSummary {
  ok: true;
  plugin_id: string;
  version: string;
  signer_id: string | null;
  risk: "low" | "medium" | "high" | "critical";
  permissions_requested: string[];
}

/**
 * Manifest preview returned by the non-committing /parse endpoint.
 * The install dialog renders this before the operator approves
 * permissions; the actual /install call comes only on consent.
 */
export interface PluginAgentParseSummary {
  ok: true;
  plugin_id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  license: string;
  risk: "low" | "medium" | "high" | "critical";
  signer_id: string | null;
  signed: boolean;
  halves: Array<"agent" | "gcs">;
  permissions: Array<{ id: string; required: boolean }>;
  /** The downloaded archive's SHA-256, present on the `parse_from_url`
   * response so the GCS can pin the subsequent install to the exact bytes the
   * operator reviewed. Absent on the multipart `/parse` response. */
  archive_sha256?: string;
  /** Shared-vocabulary named icon the manifest declares at the top level,
   * when the agent parse carries one. Drives the pop-up header glyph on the
   * install-from-URL / already-installed path. */
  icon?: string | null;
}

export interface PluginAgentManifestDetail {
  install: {
    plugin_id: string;
    version: string;
    source: string;
    source_uri: string | null;
    signer_id: string | null;
    manifest_hash: string;
    status: string;
    installed_at: number;
    enabled_at: number | null;
    permissions: Record<
      string,
      { granted: boolean; granted_at: number | null }
    >;
  };
  manifest: {
    id: string;
    version: string;
    name: string;
    risk: "low" | "medium" | "high" | "critical";
    license: string;
    halves: Array<"agent" | "gcs">;
    permissions: Array<{ id: string; required: boolean }>;
    /** The GCS half's iframe entrypoint + slot contributions, or null for
     * an agent-only plugin. Lets a LAN GCS build the contribution set and
     * locate the bundle to fetch from this agent. Older agents omit it. */
    gcs?: {
      entrypoint: string;
      contributes: {
        panels: Array<Record<string, unknown>>;
        overlays: Array<Record<string, unknown>>;
        notifications: Array<Record<string, unknown>>;
        skills: Array<Record<string, unknown>>;
        /** Node-detail tab contributions, optionally profile-narrowed. The
         * iframe slot is also surfaced under `panels`; this array carries the
         * per-tab `profile`. Older agents omit it. */
        tabs?: Array<Record<string, unknown>>;
        /** Declarative parameter contributions the GCS renders natively in
         * the plugin's settings panel. Older agents omit it. */
        parameters?: Array<Record<string, unknown>>;
        /** Target-action contributions surfaced in the cockpit target-overlay
         * popup (designate a clicked detection + flip a per-drone config key).
         * Older agents omit it. */
        target_actions?: Array<Record<string, unknown>>;
      };
      locales: string[];
    } | null;
  };
  /** Capability ids currently granted to the plugin (for ui.slot.* gating
   * without a cloud round-trip). Older agents omit it. */
  granted_capabilities?: string[];
}

/** One topic's latest published entry in a plugin's state sidecar. */
export interface PluginStateEntry {
  /** The plugin's event payload for the topic (arbitrary JSON). */
  payload: unknown;
  /** Wall-clock ms the agent recorded the event. */
  ts_ms: number;
}

/** A plugin's published-state sidecar, keyed by topic. */
export type PluginStateResponse = Record<string, PluginStateEntry>;

/** Narrow an unknown response body to the sidecar shape: a plain object whose
 * values each carry a `payload` and a numeric `ts_ms`. */
function isPluginStateResponse(body: unknown): body is PluginStateResponse {
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

  constructor(baseUrl: string, apiKey = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private authHeader(): Record<string, string> {
    return this.apiKey ? { "X-ADOS-Key": this.apiKey } : {};
  }

  async list(): Promise<{ installs: PluginAgentManifestDetail["install"][] }> {
    const res = await timedFetch(`${this.baseUrl}/api/plugins`, {
      headers: this.authHeader(),
    });
    return this.parse<{ installs: PluginAgentManifestDetail["install"][] }>(
      res,
    );
  }

  async get(pluginId: string): Promise<PluginAgentManifestDetail> {
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}`,
      { headers: this.authHeader() },
    );
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
    const rel = entrypoint.replace(/^gcs\//, "");
    const encoded = rel
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/gcs/${encoded}`,
      { headers: this.authHeader() },
    );
    if (!res.ok) {
      throw new PluginAgentError(
        res.status,
        "gcs_asset",
        `gcs bundle fetch failed: HTTP ${res.status}`,
      );
    }
    return res.text();
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
    let res: Response;
    try {
      res = await timedFetch(
        `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/state`,
        { headers: this.authHeader() },
      );
    } catch {
      return null;
    }
    if (res.status === 404) return null;
    if (!res.ok) return null;
    try {
      const body = (await res.json()) as unknown;
      return isPluginStateResponse(body) ? body : null;
    } catch {
      return null;
    }
  }

  /**
   * Read a plugin / first-party service's state sidecar as a RAW object,
   * without the topic-map (`{ topic: { payload, ts_ms } }`) shape `getState`
   * enforces. A first-party service (e.g. the world-model capture service)
   * writes a FLAT slice (`{ state, sessionId, ... }`) to the same
   * `GET /api/plugins/{id}/state` route, which `getState` would reject. This
   * returns any JSON object verbatim, or `null` on `404` / non-object /
   * transport failure, so a local-first poll never throws.
   */
  async getRawState(pluginId: string): Promise<Record<string, unknown> | null> {
    let res: Response;
    try {
      res = await timedFetch(
        `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/state`,
        { headers: this.authHeader() },
      );
    } catch {
      return null;
    }
    if (res.status === 404) return null;
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
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/parse`,
      {
        method: "POST",
        headers: this.authHeader(),
        body: form,
      },
      PLUGIN_TRANSFER_TIMEOUT_MS,
    );
    return this.parse<PluginAgentParseSummary>(res);
  }

  async install(file: File): Promise<PluginAgentInstallSummary> {
    const form = new FormData();
    form.append("file", file);
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/install`,
      {
        method: "POST",
        headers: this.authHeader(),
        body: form,
      },
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
    const res = await timedFetch(
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
   * Write a plugin's per-drone config to the LIVE plugin host over the LAN
   * (the agent's native `PUT /api/plugins/{id}/config` → the on-box control
   * socket → the running daemon's config store). `value` is any JSON value
   * (a bool for a skill toggle, a number for a follow distance). `scope`
   * defaults to per-drone on the agent. Returns the agent's `{set, scope}`.
   *
   * This is the Rule-39 local-first config-write path: it reaches the agent
   * directly with the stored pairing key, no Convex round-trip. The cloud
   * mirror (cmd_droneCommands) is a separate, later path.
   */
  async setConfig(
    pluginId: string,
    key: string,
    value: unknown,
    scope?: "drone" | "global",
  ): Promise<{ set: boolean; scope: string | null }> {
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/config`,
      {
        method: "PUT",
        headers: { ...this.authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(scope ? { key, value, scope } : { key, value }),
      },
    );
    return this.parse<{ set: boolean; scope: string | null }>(res);
  }

  async grant(pluginId: string, permissionId: string): Promise<void> {
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/grant`,
      {
        method: "POST",
        headers: { ...this.authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ permission_id: permissionId }),
      },
    );
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
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/perms/${encodeURIComponent(
        permissionId,
      )}`,
      { method: "DELETE", headers: this.authHeader() },
    );
    const body = await this.parse<{
      ok: true;
      plugin_id: string;
      granted: string[];
      requires_restart?: boolean;
    }>(res);
    return { granted: Array.isArray(body.granted) ? body.granted : [] };
  }

  async enable(pluginId: string): Promise<void> {
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/enable`,
      { method: "POST", headers: this.authHeader() },
    );
    await this.parse(res);
  }

  async disable(pluginId: string): Promise<void> {
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/disable`,
      { method: "POST", headers: this.authHeader() },
    );
    await this.parse(res);
  }

  async remove(pluginId: string, opts?: { keepData?: boolean }): Promise<void> {
    const qs = opts?.keepData ? "?keep_data=1" : "";
    const res = await timedFetch(
      `${this.baseUrl}/api/plugins/${encodeURIComponent(pluginId)}${qs}`,
      { method: "DELETE", headers: this.authHeader() },
    );
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
