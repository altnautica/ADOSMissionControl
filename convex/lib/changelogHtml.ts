/**
 * @module changelogHtml
 * @description Markdown-to-HTML for changelog entries built from commit messages.
 *
 * Commit messages (and model summaries of them) are untrusted text, and the
 * stored `bodyHtml` is injected into pages as HTML. This renderer never emits
 * markup that did not come from Markdown syntax:
 *
 *  - raw HTML in the source (block or inline) is escaped and shown as text;
 *  - a link keeps its `href` only for `http:`, `https:` and `mailto:` URLs and
 *    otherwise renders as its plain text; kept links open in a new tab with
 *    `rel="noopener noreferrer"`;
 *  - an image renders as its escaped alt text.
 *
 * Everything else is Markdown's own output, whose text content the parser
 * already escapes. A parser failure falls back to the escaped source.
 *
 * Pure (no Convex or Node APIs) so it can be unit-tested and kept identical in
 * every deployment that syncs the changelog.
 *
 * @license GPL-3.0-only
 */

import { Marked, type Tokens } from "marked";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for use in HTML content or a double-quoted attribute value. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

const changelogMarked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link): string {
      const text = this.parser.parseInline(token.tokens);
      const href = token.href.trim();
      // Keep only web and mail links; any other scheme (javascript:, data:, ...)
      // or a relative target renders as the link text alone.
      if (!/^(?:https?|mailto):/i.test(href)) return text;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image(token: Tokens.Image): string {
      return escapeHtml(token.text);
    },
  },
});

/** Render an untrusted Markdown changelog body to HTML that is safe to inject. */
export function renderChangelogBodyHtml(markdown: string): string {
  try {
    return changelogMarked.parse(markdown, { async: false });
  } catch {
    return `<p>${escapeHtml(markdown)}</p>`;
  }
}
