/**
 * @module plugins/contributions/node-pages
 * @description Parse a manifest's `gcs.contributes.agent_pages[]` and
 * `gcs.contributes.node_surfaces[]` into normalized `gcsContributes` rows: a
 * page in a node's Agent sidebar (`node.agent.page`) and a top-level
 * node-detail surface (`node.surface`).
 *
 * Validation is structural only. An entry with a bad id or no title is dropped
 * with a warning and never throws. A `section` is kept verbatim: an unknown
 * section falls back to the Software band when the sidebar is resolved, so a
 * manifest written against a newer host still lands somewhere visible.
 *
 * @license GPL-3.0-only
 */

import {
  NODE_SURFACE_GROUPS,
  type GcsContributeRow,
} from "@/lib/plugins/types";
import { readProfileList } from "./parse";

/** Page and surface ids: short, lowercase, URL- and storage-safe. */
const PAGE_ID = /^[a-z0-9-]{1,48}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

function pageId(v: unknown): string | undefined {
  return typeof v === "string" && PAGE_ID.test(v) ? v : undefined;
}

/** A parsed Agent-sidebar page row. */
export type ParsedAgentPageContribution = GcsContributeRow & {
  slot: "node.agent.page";
  title: string;
};

/** A parsed top-level node surface row. `profile` is always present. */
export type ParsedNodeSurfaceContribution = GcsContributeRow & {
  slot: "node.surface";
  title: string;
  profile: NonNullable<GcsContributeRow["profile"]>;
};

/**
 * Parse `agent_pages[]`: `{id, title, icon?, section?, after?, order?,
 * profile?[], setup_for?}`. `setup_for` names another page of the same plugin
 * that this page becomes the Setup segment of.
 */
export function parseAgentPageContributions(
  v: unknown,
): ParsedAgentPageContribution[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedAgentPageContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const panelId = pageId(entry.id);
    const title = text(entry.title);
    if (!panelId || !title) {
      console.warn("Plugin agent page dropped: needs an `id` matching [a-z0-9-]{1,48} and a `title`");
      continue;
    }
    const row: ParsedAgentPageContribution = { slot: "node.agent.page", panelId, title };
    const icon = text(entry.icon);
    const section = text(entry.section);
    const after = pageId(entry.after);
    const order = typeof entry.order === "number" && Number.isFinite(entry.order) ? entry.order : undefined;
    const profile = readProfileList(entry.profile);
    const setupFor = pageId(entry.setup_for);
    if (icon !== undefined) row.icon = icon;
    if (section !== undefined) row.section = section;
    if (after !== undefined) row.after = after;
    if (order !== undefined) row.order = order;
    if (profile) row.profile = profile;
    if (setupFor !== undefined && setupFor !== panelId) row.setupFor = setupFor;
    out.push(row);
  }
  return out;
}

/**
 * Parse `node_surfaces[]`: `{id, title, profile[] (required), group?, order?}`.
 * A surface with no recognized profile is dropped: a top-level tab must say
 * which kind of node it belongs to.
 */
export function parseNodeSurfaceContributions(
  v: unknown,
): ParsedNodeSurfaceContribution[] {
  if (!Array.isArray(v)) return [];
  const out: ParsedNodeSurfaceContribution[] = [];
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const panelId = pageId(entry.id);
    const title = text(entry.title);
    const profile = readProfileList(entry.profile);
    if (!panelId || !title || !profile) {
      console.warn("Plugin node surface dropped: needs an `id`, a `title` and a non-empty `profile` list");
      continue;
    }
    const row: ParsedNodeSurfaceContribution = { slot: "node.surface", panelId, title, profile };
    const group = NODE_SURFACE_GROUPS.find((g) => g === entry.group);
    if (group !== undefined) row.group = group;
    if (typeof entry.order === "number" && Number.isFinite(entry.order)) row.order = entry.order;
    out.push(row);
  }
  return out;
}

/** Both node page arrays of one `gcs.contributes` block, as normalized rows. */
export function parseNodePageContributions(contributes: unknown): GcsContributeRow[] {
  if (!isObject(contributes)) return [];
  return [
    ...parseAgentPageContributions(contributes.agent_pages),
    ...parseNodeSurfaceContributions(contributes.node_surfaces),
  ];
}
