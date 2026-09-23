import { describe, expect, it } from "vitest";

import { sanitizeChangelogHtml } from "@/lib/community-html";

describe("sanitizeChangelogHtml", () => {
  it("removes scripts, event handlers, and unsafe hrefs", () => {
    const html = sanitizeChangelogHtml(
      '<p onclick="alert(1)">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
    );

    expect(html).toContain("<p>Hi</p>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
  });

  it("keeps safe changelog links with external-link guards", () => {
    const html = sanitizeChangelogHtml('<a href="https://example.com">read</a>');

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("keeps language classes and drops every other class", () => {
    const html = sanitizeChangelogHtml(
      '<pre class="fixed inset-0 z-50 language-ts"><code class="language-ts bg-bg-primary">x</code></pre>',
    );
    expect(html).toBe('<pre class="language-ts"><code class="language-ts">x</code></pre>');
  });
});
