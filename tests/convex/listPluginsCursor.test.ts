/**
 * The registry catalog pages through its published plugins: following
 * `nextCursor` returns the next slice, and the last page ends the walk.
 */
import { describe, expect, it } from "vitest";

import * as registry from "../../convex/pluginRegistry";
import { invoke, makeCtx } from "./fakeConvexCtx";

interface Page {
  items: Array<{ plugin_id: string }>;
  nextCursor: string | null;
  total: number;
}

describe("pluginRegistry.listPlugins paging", () => {
  it("walks every published plugin exactly once by following nextCursor", async () => {
    const ctx = makeCtx();
    ctx.db.seed(
      "registry_plugins",
      Array.from({ length: 5 }, (_, i) => ({
        plugin_id: `com.example.p${i}`,
        name: `p${i}`,
        description: "",
        status: "published",
        updated_at: 100 - i,
      })),
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages++) {
      const page = (await invoke(registry.listPlugins, ctx, { limit: 2, cursor })) as Page;
      seen.push(...page.items.map((p) => p.plugin_id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([
      "com.example.p0",
      "com.example.p1",
      "com.example.p2",
      "com.example.p3",
      "com.example.p4",
    ]);
  });

  it("refuses a cursor it never handed out", async () => {
    const ctx = makeCtx();
    await expect(invoke(registry.listPlugins, ctx, { cursor: "abc" })).rejects.toThrow(/cursor/);
  });
});
