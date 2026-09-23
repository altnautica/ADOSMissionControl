/**
 * @module plugins/contributions/parse
 * @description Parse the remaining `gcs.contributes.*` blocks of a plugin
 * manifest into validated contribution rows — node-detail tabs, settings
 * sections (with nested native parameters), model registrations, mission
 * templates, and map overlays. The skills, iframe slots, and parameters live
 * in their own parsers; this module covers the rest of the contribution
 * surface.
 *
 * Forward-compatible: an entry without a stable id, or one that names a
 * retired/non-matching slot, is dropped with a console warning and never
 * throws — matching the parse-drop discipline of `manifest-parse.ts` and
 * `parameters/parse.ts`. Each parser returns `undefined` when no valid entry
 * is found.
 *
 * @license GPL-3.0-only
 */

import { type PairedNodeProfile } from "@/lib/plugins/types";
import {
  parseParameterContributions,
  type ParsedParameterContribution,
} from "@/lib/plugins/parameters/parse";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function warn(message: string): void {
  if (typeof console !== "undefined") console.warn(message);
}

/** Read an entry's stable id, accepting either `id` or `key`. */
function readId(entry: Record<string, unknown>): string | undefined {
  return str(entry.id) ?? str(entry.key);
}

const NODE_PROFILES: ReadonlySet<string> = new Set([
  "drone",
  "ground-station",
  "workstation",
]);

/** Parse a `profile:` list into the recognized node-profile values, dropping
 * unknown and duplicate entries. Returns undefined when none remain. */
function readProfileList(v: unknown): PairedNodeProfile[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PairedNodeProfile[] = [];
  for (const item of v) {
    const s = str(item);
    if (s !== undefined && NODE_PROFILES.has(s)) {
      const profile = s as PairedNodeProfile;
      if (!out.includes(profile)) out.push(profile);
    }
  }
  return out.length > 0 ? out : undefined;
}

/**
 * One `gcs.contributes.tabs[]` entry: a detail tab the plugin mounts on a
 * node's detail panel. The slot is always `node.detail.tab`; an optional
 * `profile` list narrows which node profiles offer the tab.
 */
export interface ParsedTabContribution {
  /** The node-detail tab slot. */
  slot: "node.detail.tab";
  /** Stable id within the plugin (the contribution's `id`/`key`). */
  panelId: string;
  /** Node profiles the tab is offered on. Absent means "any profile the host
   * allows". */
  profile?: PairedNodeProfile[];
  /** Display title for the tab header. */
  title?: string;
  /** lucide-react icon hint. */
  icon?: string;
  /** Sort hint within the tab strip. */
  order?: number;
  /** Bundle entrypoint the host mounts (relative path inside the archive). */
  entrypoint?: string;
}

/**
 * Parse `gcs.contributes.tabs[]`. Each entry needs a stable `id`/`key` and
 * resolves to the `node.detail.tab` slot. An optional `profile` list narrows
 * the node profiles that offer the tab. Entries without an id are dropped +
 * warned.
 */
export function parseTabContributions(
  v: unknown,
): ParsedTabContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedTabContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const panelId = readId(entry);
    if (!panelId) {
      warn("Plugin tab contribution dropped: missing string `id`");
      continue;
    }

    const row: ParsedTabContribution = { slot: "node.detail.tab", panelId };
    const profile = readProfileList(entry.profile);
    if (profile) row.profile = profile;
    const title = str(entry.title);
    const icon = str(entry.icon);
    const order = num(entry.order);
    const entrypoint = str(entry.entrypoint);
    if (title !== undefined) row.title = title;
    if (icon !== undefined) row.icon = icon;
    if (order !== undefined) row.order = order;
    if (entrypoint !== undefined) row.entrypoint = entrypoint;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * One `contributes.tools[]` entry: an MCP tool the plugin exposes to an AI
 * client. `name` is the stable id within the plugin (namespaced
 * `${pluginId}:${name}` at the connector). `half` says whether the tool runs on
 * the agent (invoked over the per-plugin socket) or the GCS.
 */
export interface ParsedToolContribution {
  name: string;
  title?: string;
  description?: string;
  /** read | safe_write | admin | flight_action | destructive (verbatim). */
  safetyClass?: string;
  half?: "agent" | "gcs";
  inputSchema?: Record<string, unknown>;
}

/** Parse `contributes.tools[]`. Each entry needs a stable `name`; a `half` other
 * than agent/gcs is dropped to undefined. Entries without a name are dropped +
 * warned (never thrown). */
export function parseToolContributions(v: unknown): ParsedToolContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedToolContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const name = str(entry.name);
    if (!name) {
      warn("Plugin tool contribution dropped: missing string `name`");
      continue;
    }
    const row: ParsedToolContribution = { name };
    const title = str(entry.title);
    const description = str(entry.description);
    const safetyClass = str(entry.safety_class ?? entry.safetyClass);
    const half = str(entry.half);
    if (title !== undefined) row.title = title;
    if (description !== undefined) row.description = description;
    if (safetyClass !== undefined) row.safetyClass = safetyClass;
    if (half === "agent" || half === "gcs") row.half = half;
    if (isObject(entry.inputSchema)) row.inputSchema = entry.inputSchema;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/** One `contributes.resources[]` entry: an MCP resource the plugin exposes. */
export interface ParsedResourceContribution {
  uri: string;
  name?: string;
  mimeType?: string;
  subscribable?: boolean;
}

/** Parse `contributes.resources[]`. Each entry needs a stable `uri`. */
export function parseResourceContributions(v: unknown): ParsedResourceContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedResourceContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const uri = str(entry.uri);
    if (!uri) {
      warn("Plugin resource contribution dropped: missing string `uri`");
      continue;
    }
    const row: ParsedResourceContribution = { uri };
    const name = str(entry.name);
    const mimeType = str(entry.mimeType ?? entry.mime_type);
    if (name !== undefined) row.name = name;
    if (mimeType !== undefined) row.mimeType = mimeType;
    if (typeof entry.subscribable === "boolean") row.subscribable = entry.subscribable;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/** One `contributes.prompts[]` entry: an MCP prompt the plugin exposes. */
export interface ParsedPromptContribution {
  name: string;
  title?: string;
  description?: string;
}

/** Parse `contributes.prompts[]`. Each entry needs a stable `name`. */
export function parsePromptContributions(v: unknown): ParsedPromptContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedPromptContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const name = str(entry.name);
    if (!name) {
      warn("Plugin prompt contribution dropped: missing string `name`");
      continue;
    }
    const row: ParsedPromptContribution = { name };
    const title = str(entry.title);
    const description = str(entry.description);
    if (title !== undefined) row.title = title;
    if (description !== undefined) row.description = description;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * One `gcs.contributes.settings[]` entry: a section in the plugin's settings
 * panel holding native declarative parameters.
 */
export interface ParsedSettingsContribution {
  /** Stable id within the plugin. */
  id: string;
  /** Section heading. */
  title?: string;
  /** lucide-react icon hint. */
  icon?: string;
  /** Sort hint among sections. */
  order?: number;
  /** Native declarative parameters rendered in this section. */
  parameters?: ParsedParameterContribution[];
}

/**
 * Parse `gcs.contributes.settings[]`. Each entry needs a stable `id`/`key`;
 * its nested `parameters` are parsed via `parseParameterContributions` (invalid
 * parameters drop individually). Entries without an id are dropped + warned.
 */
export function parseSettingsContributions(
  v: unknown,
): ParsedSettingsContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedSettingsContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const id = readId(entry);
    if (!id) {
      warn("Plugin settings section dropped: missing string `id`");
      continue;
    }
    const row: ParsedSettingsContribution = { id };
    const title = str(entry.title);
    const icon = str(entry.icon);
    const order = num(entry.order);
    if (title !== undefined) row.title = title;
    if (icon !== undefined) row.icon = icon;
    if (order !== undefined) row.order = order;
    const parameters = parseParameterContributions(entry.parameters);
    if (parameters) row.parameters = parameters;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/** One per-board model variant under a model contribution. */
export interface ParsedModelBoardVariant {
  /** Board fingerprint match (SoC/board substring). */
  boardMatch?: string;
  /** Inference runtime the variant targets (e.g. an ONNX/RKNN runtime). */
  runtime?: string;
  /** Input resolution hint. */
  input?: string;
  /** Minimum NPU throughput the variant needs. */
  minTops?: number;
  /** Download source for the model file. */
  source?: string;
  /** Expected SHA-256 of the model file. */
  sha256?: string;
}

/**
 * One `gcs.contributes.models[]` entry: a model the plugin registers for a
 * vision task, with per-board variants the agent selects from.
 */
export interface ParsedModelContribution {
  /** Stable id within the plugin. */
  id: string;
  /** Vision task the model serves (e.g. "detection" | "reid" | "depth"). */
  task?: string;
  /** Per-board variants. */
  boardVariants?: ParsedModelBoardVariant[];
}

function parseBoardVariants(v: unknown): ParsedModelBoardVariant[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedModelBoardVariant[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const variant: ParsedModelBoardVariant = {};
    const boardMatch = str(entry.board_match ?? entry.boardMatch);
    const runtime = str(entry.runtime);
    const input = str(entry.input);
    const minTops = num(entry.min_tops ?? entry.minTops);
    const source = str(entry.source);
    const sha256 = str(entry.sha256);
    if (boardMatch !== undefined) variant.boardMatch = boardMatch;
    if (runtime !== undefined) variant.runtime = runtime;
    if (input !== undefined) variant.input = input;
    if (minTops !== undefined) variant.minTops = minTops;
    if (source !== undefined) variant.source = source;
    if (sha256 !== undefined) variant.sha256 = sha256;
    // Keep only a variant that carries at least one field.
    if (Object.keys(variant).length > 0) out.push(variant);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Parse `gcs.contributes.models[]`. Each entry needs a stable `id`/`key`; the
 * optional `board_variants` array is parsed field-by-field. Entries without an
 * id are dropped + warned.
 */
export function parseModelContributions(
  v: unknown,
): ParsedModelContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedModelContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const id = readId(entry);
    if (!id) {
      warn("Plugin model contribution dropped: missing string `id`");
      continue;
    }
    const row: ParsedModelContribution = { id };
    const task = str(entry.task);
    if (task !== undefined) row.task = task;
    const boardVariants = parseBoardVariants(
      entry.board_variants ?? entry.boardVariants,
    );
    if (boardVariants) row.boardVariants = boardVariants;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/** Shared shape for the simple entrypoint-bearing contributions (mission
 * templates, map overlays): a stable id plus optional display + entrypoint. */
interface ParsedEntrypointContribution {
  id: string;
  title?: string;
  icon?: string;
  entrypoint?: string;
}

function parseEntrypointContributions(
  v: unknown,
  kind: string,
): ParsedEntrypointContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedEntrypointContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const id = readId(entry);
    if (!id) {
      warn(`Plugin ${kind} contribution dropped: missing string \`id\``);
      continue;
    }
    const row: ParsedEntrypointContribution = { id };
    const title = str(entry.title);
    const icon = str(entry.icon);
    const entrypoint = str(entry.entrypoint);
    if (title !== undefined) row.title = title;
    if (icon !== undefined) row.icon = icon;
    if (entrypoint !== undefined) row.entrypoint = entrypoint;
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}

/** One `gcs.contributes.missionTemplates[]` entry. */
export type ParsedMissionTemplateContribution = ParsedEntrypointContribution;

/** One `gcs.contributes.mapOverlays[]` entry. */
export type ParsedMapOverlayContribution = ParsedEntrypointContribution;

/** Parse `gcs.contributes.missionTemplates[]`. Entries without an id drop. */
export function parseMissionTemplateContributions(
  v: unknown,
): ParsedMissionTemplateContribution[] | undefined {
  return parseEntrypointContributions(v, "mission template");
}

/** Parse `gcs.contributes.mapOverlays[]`. Entries without an id drop. */
export function parseMapOverlayContributions(
  v: unknown,
): ParsedMapOverlayContribution[] | undefined {
  return parseEntrypointContributions(v, "map overlay");
}
