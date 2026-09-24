/**
 * @module PluginClientTypes
 * @description Wire shapes the agent's plugin lifecycle endpoints
 * (`/api/plugins/*`) answer with, read by `PluginAgentClient`.
 *
 * @license GPL-3.0-only
 */

import type { GcsIsolation } from "@/lib/plugins/types";

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
    /** MCP tools / resources / prompts declared across both halves, each
     * with a `half` marker. Exposed to MCP clients only while the plugin
     * holds `mcp.expose` (see `granted_capabilities`). */
    mcp?: { tools?: unknown[]; resources?: unknown[]; prompts?: unknown[] };
    /** The GCS half's entrypoint + slot contributions, or null for an
     * agent-only plugin. Lets a LAN GCS build the contribution set and
     * locate the module to fetch from this agent. Older agents omit it. */
    gcs?: {
      entrypoint: string;
      /** How the GCS half mounts; older agents omit it (= iframe). */
      isolation?: GcsIsolation;
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
        /** Agent-sidebar pages and node surfaces; older agents omit them. */
        agent_pages?: unknown[];
        node_surfaces?: unknown[];
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
