/**
 * Changelog bodies are rendered from commit text that anyone can author, and the
 * stored HTML is injected into pages. These tests pin that the renderer never
 * lets markup or script-bearing URLs through.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { renderChangelogBodyHtml } from "../../convex/lib/changelogHtml";

describe("renderChangelogBodyHtml", () => {
  it("renders ordinary Markdown", () => {
    const html = renderChangelogBodyHtml("Adds **bold** and `code`.\n\n- one\n- two");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>one</li>");
  });

  it("escapes raw HTML, block and inline", () => {
    const html = renderChangelogBodyHtml(
      'Fix <img src=x onerror="alert(1)"> here\n\n<script>alert(2)</script>',
    );
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops link targets outside http, https and mailto", () => {
    for (const href of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "/relative"]) {
      const html = renderChangelogBodyHtml(`[click](${href})`);
      expect(html, href).not.toContain("<a");
      expect(html, href).toContain("click");
    }
  });

  it("keeps web links, opening them without an opener reference", () => {
    const html = renderChangelogBodyHtml('[docs](https://example.com/a?b=1&c="2")');
    expect(html).toContain(
      '<a href="https://example.com/a?b=1&amp;c=&quot;2&quot;" target="_blank" rel="noopener noreferrer">docs</a>',
    );
  });

  it("renders an image as its alt text only", () => {
    const html = renderChangelogBodyHtml('![<b>alt</b>](https://example.com/x.png)');
    expect(html).not.toMatch(/<img|<b>/i);
  });
});
