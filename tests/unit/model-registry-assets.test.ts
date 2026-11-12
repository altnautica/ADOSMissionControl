import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The public model registry may only point at release assets that exist.
// Each published release tag the registry links to is listed here; a new
// tag is added only after its release is published.
const PUBLISHED_TAGS: Record<string, true> = { "vision-models-v2": true };

interface Variant {
  url?: string;
}
interface Model {
  id: string;
  variants: Variant[];
}

const registry = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "..", "..", "public", "models", "registry.json"),
    "utf8",
  ),
) as { models: Model[] };

describe("public model registry", () => {
  it("links only to published release tags of the extensions repository", () => {
    const tags = registry.models.flatMap((m) =>
      m.variants
        .map((v) => v.url?.match(/altnautica\/ADOSExtensions\/releases\/download\/([^/]+)\//)?.[1])
        .filter((t): t is string => Boolean(t)),
    );
    for (const tag of tags) expect(PUBLISHED_TAGS[tag], tag).toBe(true);
  });

  it("lists at least one variant per model", () => {
    for (const m of registry.models) expect(m.variants.length, m.id).toBeGreaterThan(0);
  });
});
