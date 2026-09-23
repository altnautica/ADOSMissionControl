/**
 * Shared agent-route helpers that the production deployment keeps as
 * byte-for-byte copies, since a Convex deployment can only import from its own
 * `convex/` dir. This guard proves each copy has not drifted from the tested
 * original here, so the production routes run the covered code. When only this
 * repository is checked out the comparison is skipped (reported as skipped,
 * never a false pass).
 *
 * @license GPL-3.0-only
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIRRORED = [
  "convex/lib/heartbeatFields.ts",
  "convex/lib/atlasJobsIngest.ts",
  "convex/lib/changelogHtml.ts",
  "convex/lib/credentials.ts",
];

describe("production mirrors of the agent-route helpers", () => {
  for (const rel of MIRRORED) {
    const mirror = resolve(process.cwd(), "../website", rel);
    it.skipIf(!existsSync(mirror))(`${rel} is byte-identical`, () => {
      expect(readFileSync(mirror, "utf-8"), `re-copy ${rel} into the production deployment`).toBe(
        readFileSync(join(process.cwd(), rel), "utf-8"),
      );
    });
  }
});
