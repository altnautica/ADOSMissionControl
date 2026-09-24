/**
 * @module node-detail/agent/plugin-nav
 * @description Places plugin-contributed Agent pages into the resolved
 * sidebar sections.
 *
 * A page lands in the section its manifest names; an unknown section falls
 * back to Software so a manifest written against a newer host still shows.
 * Within a section, a page with `after` sits directly below that page when it
 * is in the same section (a built-in id, or another page of the same plugin);
 * every other page is appended after the built-ins by `order`, then plugin id.
 * A page with `setupFor` becomes the Setup segment of that page of its own
 * plugin, like a built-in `mergeInto`, and keeps its own row only when the host
 * page is absent on this node.
 * @license GPL-3.0-only
 */

import type { AgentNavContribution, SurfaceContext } from "../surface-types";
import { pluginPageId } from "../surface-types";
import type { AgentNavEntry } from "./agent-nav-sections";

/** The i18n fallback behind a plugin page's literal label. */
export const PLUGIN_PAGE_LABEL_KEY = "dronePanel.pluginPage";

/** The section a page whose manifest names an unknown one lands in. */
const FALLBACK_SECTION = "software";

function byOrder(a: AgentNavContribution, b: AgentNavContribution): number {
  return (
    a.order - b.order ||
    a.pluginId.localeCompare(b.pluginId) ||
    a.panelId.localeCompare(b.panelId)
  );
}

/**
 * Append each plugin page to its section, in place. `sections` still holds
 * every `NAV_SECTIONS` entry (empty ones included), so a page can open a
 * section that no built-in page populated on this node.
 */
export function placePluginPages(
  sections: ReadonlyArray<{ key: string; items: AgentNavEntry[] }>,
  pages: ReadonlyArray<AgentNavContribution>,
  ctx: SurfaceContext,
): void {
  if (pages.length === 0) return;
  const pageIds = new Set(pages.map((p) => p.id));

  // Setup halves attach to their host page; the rest become rows.
  const setupFor = new Map<string, AgentNavContribution>();
  const rows: AgentNavContribution[] = [];
  for (const page of pages) {
    const hostId = page.setupFor ? pluginPageId(page.pluginId, page.setupFor) : null;
    const host = hostId ? pages.find((p) => p.id === hostId && !p.setupFor) : undefined;
    if (hostId && host) setupFor.set(hostId, page);
    else rows.push(page);
  }

  const toEntry = (page: AgentNavContribution): AgentNavEntry => {
    const setup = setupFor.get(page.id);
    return {
      id: page.id,
      labelKey: PLUGIN_PAGE_LABEL_KEY,
      label: page.label,
      icon: page.icon,
      isConfigPage: false,
      readsConfig: false,
      render: () => page.render(ctx),
      ...(setup
        ? {
            setup: {
              labelKey: PLUGIN_PAGE_LABEL_KEY,
              label: setup.label,
              readsConfig: false,
              render: () => setup.render(ctx),
            },
          }
        : {}),
    };
  };

  // `after` names a page of the same plugin first, else a built-in page.
  const anchorOf = (page: AgentNavContribution): string | undefined => {
    if (!page.after) return undefined;
    const own = pluginPageId(page.pluginId, page.after);
    return pageIds.has(own) ? own : page.after;
  };

  const known = new Set(sections.map((s) => s.key));
  for (const section of sections) {
    const mine = rows
      .filter((p) => (known.has(p.section) ? p.section : FALLBACK_SECTION) === section.key)
      .sort(byOrder);
    if (mine.length === 0) continue;

    // An anchor that will never be in this section falls back to order.
    const present = new Set([
      ...section.items.map((e) => e.id),
      ...mine.map((p) => p.id),
    ]);
    let pending: Array<{ page: AgentNavContribution; anchor: string }> = [];
    for (const page of mine) {
      const anchor = anchorOf(page);
      if (anchor && present.has(anchor) && anchor !== page.id) pending.push({ page, anchor });
      else section.items.push(toEntry(page));
    }

    // Insert anchored pages below their anchor, after any page already
    // anchored to it, so several pages under one anchor keep manifest order.
    // A page whose anchor is itself still pending waits for the next pass.
    const anchoredTo = new Map<string, string>();
    while (pending.length > 0) {
      const waiting: typeof pending = [];
      for (const item of pending) {
        const at = section.items.findIndex((e) => e.id === item.anchor);
        if (at < 0) {
          waiting.push(item);
          continue;
        }
        let insertAt = at + 1;
        while (
          insertAt < section.items.length &&
          anchoredTo.get(section.items[insertAt].id) === item.anchor
        ) {
          insertAt += 1;
        }
        section.items.splice(insertAt, 0, toEntry(item.page));
        anchoredTo.set(item.page.id, item.anchor);
      }
      // A cycle of `after` references never resolves: append in order.
      if (waiting.length === pending.length) {
        for (const item of waiting) section.items.push(toEntry(item.page));
        break;
      }
      pending = waiting;
    }
  }
}
