/**
 * @module lib/mcp/activity
 * @description Shared model for the live MCP activity feed. The MCP server (a
 * separate local process) writes one audit line per tool call to a local
 * newline-delimited JSON file; a same-machine GCS tails it over SSE. This module
 * is the single source of truth for the wire shape, the plain-language summary,
 * the coarse category (for filter chips), and the tool -> GCS-surface map that
 * the auto-navigate bridge follows. No cloud, no network — the feed is
 * local-first (the file is on the operator's own machine).
 * @license GPL-3.0-only
 */

/** The gate outcome carried on each event (mirror of the connector's shape). */
export type McpDecision = "allowed" | "denied" | "confirmed" | "operator_absent";
/** Which data plane carried the call. */
export type McpPlane = "lan_direct" | "cloud_relay" | "on_box";
/** The lifecycle phase. Completed events carry no phase (treated as `done`);
 *  the optional running lane emits `started` first for a pending -> done feel. */
export type McpPhase = "started" | "done";

/**
 * The wire event exactly as the MCP server writes it to `audit.ndjson`
 * (completed calls) or the optional `activity.ndjson` (start markers). Kept
 * loose — every field optional — so a forward-compatible producer never breaks
 * the tail. `phase`/`callId` ride only the optional running lane.
 */
export interface McpActivityWire {
  tsUs?: number;
  tool?: string;
  args?: Record<string, unknown>;
  node?: string;
  decision?: McpDecision;
  result?: string;
  latencyMs?: number;
  mcpSession?: string;
  plane?: McpPlane;
  sensitiveRead?: boolean;
  phase?: McpPhase;
  callId?: string;
}

/** A control frame the SSE route emits instead of an event line. */
export interface McpChannelFrame {
  channel: "connecting" | "waiting" | "live" | "unavailable";
}

/** The state of the local file channel. */
export type McpChannelState = "connecting" | "waiting" | "live" | "unavailable";

/** Coarse grouping for the filter chips. */
export type McpCategory = "drone" | "mission" | "config" | "query" | "other";

/** Where a tool's effect is shown in the GCS — a node-detail tab or a route. */
export type McpSurface =
  | { kind: "tab"; id: string }
  | { kind: "route"; path: string }
  | null;

/** One rendered activity row (a resolved wire event). */
export interface McpActivityRow {
  /** Client-side unique id (stable across a running -> done merge by callId). */
  id: string;
  /** Pairing key for the running lane; absent on completion-only events. */
  callId?: string;
  tsUs: number;
  tool: string;
  /** Plain-language effect, e.g. "Set INS_HNTCH_OPTS -> 2". */
  summary: string;
  category: McpCategory;
  /** The target node string as written (deviceId in fleet-mode, else local). */
  node: string;
  decision: McpDecision;
  /** running = start seen, no completion yet; success/error = terminal. */
  lifecycle: "running" | "success" | "error";
  result: string;
  latencyMs: number;
  args: Record<string, unknown>;
  plane: McpPlane;
  /** The GCS surface this tool acts on (for the "Jump to" affordance). */
  surface: McpSurface;
}

/** The dotted tool's namespace, e.g. `params.set` -> `params`. */
export function toolNamespace(tool: string): string {
  const dot = tool.indexOf(".");
  return dot === -1 ? tool : tool.slice(0, dot);
}

/** The dotted tool's verb, e.g. `params.set` -> `set`. */
export function toolVerb(tool: string): string {
  const dot = tool.indexOf(".");
  return dot === -1 ? "" : tool.slice(dot + 1);
}

/** Coarse category for the filter chips, derived from the namespace. */
export function categoryForTool(tool: string): McpCategory {
  switch (toolNamespace(tool)) {
    case "flight":
    case "vision":
    case "video":
      return "drone";
    case "mission":
      return "mission";
    case "params":
    case "config":
    case "services":
    case "admin":
    case "network":
    case "wfb":
    case "pairing":
    case "plugins":
      return "config";
    case "status":
    case "telemetry":
    case "logs":
    case "audit":
    case "fleet":
      return "query";
    default:
      return "other";
  }
}

/**
 * The GCS surface a tool acts on. Node-detail tabs (`overview`/`parameters`/
 * `system`/`plugins`/`vision`/`logs`/`cockpit`, the last one labelled
 * Flight) resolve to `setPendingDetailTab`; whole-page tools resolve to a
 * route. Fleet/MCP-level
 * tools have no single surface -> the MCP tab. Unknowns -> null (feed-only).
 */
export function surfaceForTool(tool: string): McpSurface {
  switch (toolNamespace(tool)) {
    case "params":
      return { kind: "tab", id: "parameters" };
    case "flight":
    case "video":
      return { kind: "tab", id: "cockpit" };
    case "config":
    case "services":
    case "admin":
    case "network":
    case "wfb":
    case "pairing":
      return { kind: "tab", id: "system" };
    case "plugins":
      return { kind: "tab", id: "plugins" };
    case "vision":
      return { kind: "tab", id: "vision" };
    case "logs":
    case "audit":
      return { kind: "tab", id: "logs" };
    case "status":
    case "telemetry":
      return { kind: "tab", id: "overview" };
    case "mission":
      return { kind: "route", path: "/plan" };
    case "fleet":
    case "mcp":
      return { kind: "route", path: "/mcp" };
    default:
      return null;
  }
}

function firstString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * A short, human-readable description of a tool call's effect — the *effect*,
 * not the raw tool name (which lives in the expanded row). Falls back to a
 * humanized `namespace · verb` so an unmapped tool still reads cleanly.
 */
export function summarizeTool(tool: string, args: Record<string, unknown> = {}): string {
  const ns = toolNamespace(tool);
  const verb = toolVerb(tool);
  const name = firstString(args, ["name", "param", "key", "id", "plugin", "mode", "service"]);
  const value = firstString(args, ["value", "state", "mode"]);

  switch (ns) {
    case "params": {
      if (verb === "set" && name != null)
        return value != null ? `Set ${name} → ${value}` : `Set ${name}`;
      if (verb === "get" && name != null) return `Read ${name}`;
      if (verb === "get") return "Read parameters";
      break;
    }
    case "config": {
      if (verb === "set" && name != null)
        return value != null ? `Set ${name} → ${value}` : `Set ${name}`;
      if (verb === "get") return name != null ? `Read config ${name}` : "Read config";
      break;
    }
    case "flight": {
      if (verb === "arm") return "Arm";
      if (verb === "disarm") return "Disarm";
      if (verb === "mode") return value != null ? `Set mode ${value}` : "Set flight mode";
      if (verb === "takeoff") return "Take off";
      if (verb === "land") return "Land";
      if (verb === "rtl" || verb === "return") return "Return to launch";
      if (verb === "goto") return "Go to point";
      break;
    }
    case "mission": {
      if (verb === "upload" || verb === "write") return "Upload mission";
      if (verb === "download" || verb === "read") return "Read mission";
      if (verb === "clear") return "Clear mission";
      if (verb === "start") return "Start mission";
      break;
    }
    case "services": {
      if (verb === "restart") return name != null ? `Restart ${name}` : "Restart service";
      if (verb === "list") return "List services";
      break;
    }
    case "plugins": {
      if (verb === "install") return name != null ? `Install ${name}` : "Install plugin";
      if (verb === "enable") return name != null ? `Enable ${name}` : "Enable plugin";
      if (verb === "disable") return name != null ? `Disable ${name}` : "Disable plugin";
      if (verb === "remove") return name != null ? `Remove ${name}` : "Remove plugin";
      if (verb === "list") return "List plugins";
      break;
    }
    case "status":
      return "Read status";
    case "telemetry":
      return "Read telemetry";
    case "logs":
      return verb === "query" ? "Query logs" : "Read logs";
    case "admin": {
      if (verb === "rename" && value != null) return `Rename → ${value}`;
      if (verb === "update") return "Update agent";
      break;
    }
    default:
      break;
  }
  // Fallback: humanize `namespace · verb`.
  return verb ? `${ns} · ${verb.replace(/_/g, " ")}` : ns;
}

/** Map a decision to the shared StatusDot vocabulary. */
export function decisionStatus(
  decision: McpDecision,
  lifecycle: "running" | "success" | "error",
): "good" | "warning" | "critical" | "idle" | "serious" {
  if (lifecycle === "running") return "idle";
  if (lifecycle === "error") return "critical";
  switch (decision) {
    case "allowed":
      return "good";
    case "confirmed":
      return "good";
    case "denied":
      return "critical";
    case "operator_absent":
      return "warning";
    default:
      return "serious";
  }
}
