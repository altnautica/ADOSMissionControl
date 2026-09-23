import sanitizeHtml from "sanitize-html";

const ALLOWED_CHANGELOG_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
];

export function sanitizeChangelogHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_CHANGELOG_TAGS,
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      code: ["class"],
      pre: ["class"],
    },
    // Only syntax-highlight language classes survive; any other class could
    // restyle an entry into a page-covering overlay.
    allowedClasses: {
      code: [/^language-[\w-]+$/],
      pre: [/^language-[\w-]+$/],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });
}
