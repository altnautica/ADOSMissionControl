/**
 * @module heartbeat-casing-mirror.test
 * @description Drift guard for the shared snake→camel heartbeat helper.
 *
 * The `/agent/status` route runs in two Convex deployments: this OSS twin
 * (`convex/heartbeatCasing.ts`, unit-tested here and in
 * `cmdDroneStatusContract.test.ts`) and the production superset the hosted apps
 * share (the sibling `website/convex/` deployment — see CLAUDE.md "For the
 * hosted version"). A Convex deployment can only import from its own `convex/`
 * dir, so the production route cannot import this module directly: it keeps a
 * byte-for-byte MIRROR at `website/convex/heartbeatCasing.ts` and imports that.
 *
 * This guard proves the production mirror has not drifted from the tested
 * original, so the exact transform the production route runs is the one covered
 * by tests. The mirror lives outside this repo, so when only this repo is
 * checked out the comparison is skipped (reported as skipped, never a false
 * green); wherever both packages are present it is enforced.
 *
 * @license GPL-3.0-only
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { snakeToCamelObject } from "../../convex/heartbeatCasing";

const CANONICAL_PATH = join(process.cwd(), "convex/heartbeatCasing.ts");
// The production superset deployment sits beside this package in the monorepo.
const MIRROR_PATH = resolve(process.cwd(), "../website/convex/heartbeatCasing.ts");
const mirrorPresent = existsSync(MIRROR_PATH);

describe("heartbeat casing helper", () => {
  it("the canonical helper exists, exports the remap, and remaps keys", () => {
    expect(existsSync(CANONICAL_PATH)).toBe(true);
    const text = readFileSync(CANONICAL_PATH, "utf-8");
    expect(text.length).toBeGreaterThan(0);
    // The mirror contract depends on these exact export names; a rename here
    // would silently break the production import even if the file still exists.
    expect(text).toContain("export function snakeToCamelKey");
    expect(text).toContain("export function snakeToCamelObject");
    // And the exported transform actually does the snake→camel remap the route
    // depends on (nothing snake_case survives to the strict validator).
    const out = snakeToCamelObject({ rssi_dbm: -51, lq_uplink: 100 });
    expect(out).toEqual({ rssiDbm: -51, lqUplink: 100 });
  });

  it.skipIf(!mirrorPresent)(
    "the production website mirror is byte-identical to the canonical helper",
    () => {
      const canonical = readFileSync(CANONICAL_PATH, "utf-8");
      const mirror = readFileSync(MIRROR_PATH, "utf-8");
      expect(
        mirror,
        "website/convex/heartbeatCasing.ts has drifted from convex/heartbeatCasing.ts — " +
          "re-copy the canonical helper so the production route runs the tested transform",
      ).toBe(canonical);
    },
  );
});
