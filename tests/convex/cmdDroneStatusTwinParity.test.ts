/**
 * @module cmdDroneStatusTwinParity.test
 * @description Shape parity between the two Convex heartbeat twins.
 *
 * The heartbeat contract is duplicated: this OSS twin (`convex/`) and the
 * production superset the hosted apps actually run (`website/convex/`). The
 * house rule is that shared functions are synced to both, and the existing
 * `scripts/check-convex-twins.sh` compares a function's EXPOSURE — but nothing
 * compared the validators.
 *
 * That gap matters more than a name-set drift would suggest. The `pushStatus`
 * args and the `cmd_droneStatus` columns are strict `v.object()`s, so an
 * undeclared key does not get dropped: it REJECTS THE WHOLE HEARTBEAT and the
 * node goes dark in cloud mode every tick (see `convex/heartbeatCasing.ts`).
 * Losing an `optional()` does the same to every agent that omits the field.
 *
 * A textual diff is the wrong gate — the twins legitimately order fields
 * differently and carry different comment prose, which is pure noise. This
 * compares an order-insensitive map from field name to the VERBATIM validator
 * expression, whitespace-normalized because the same nested `v.object(...)` is
 * wrapped across different line counts in the two files.
 *
 * The production twin lives outside this repo, so a lone-repo checkout skips
 * (reported as skipped, never a false green), matching `heartbeat-casing-mirror`.
 *
 * @license GPL-3.0-only
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseArgsBlock,
  parseSchemaTableKeys,
} from "./convexSourceParsers";

const OSS_MUTATION = join(process.cwd(), "convex/cmdDroneStatus.ts");
const OSS_SCHEMA = join(process.cwd(), "convex/schema.ts");
const OSS_HTTP = join(process.cwd(), "convex/http.ts");
/** The production superset deployment sits beside this package in the monorepo. */
const PROD_MUTATION = resolve(process.cwd(), "../website/convex/cmdDroneStatus.ts");
const PROD_SCHEMA = resolve(process.cwd(), "../website/convex/schema.ts");

const prodPresent = existsSync(PROD_MUTATION) && existsSync(PROD_SCHEMA);

describe("cmd_droneStatus twin parity", () => {
  it.skipIf(!prodPresent)(
    "pushStatus declares the same field set in both twins",
    () => {
      const oss = parseArgsBlock(readFileSync(OSS_MUTATION, "utf-8"), "pushStatus");
      const prod = parseArgsBlock(readFileSync(PROD_MUTATION, "utf-8"), "pushStatus");

      const ossNames = [...oss.keys()].sort();
      const prodNames = [...prod.keys()].sort();
      const onlyOss = ossNames.filter((n) => !prod.has(n));
      const onlyProd = prodNames.filter((n) => !oss.has(n));

      expect(
        { onlyOss, onlyProd },
        "a field one twin declares and the other does not is a heartbeat the " +
          "production deployment rejects outright, not a dropped field",
      ).toEqual({ onlyOss: [], onlyProd: [] });
    },
  );

  it.skipIf(!prodPresent)(
    "every pushStatus field has the same validator SHAPE in both twins",
    () => {
      const oss = parseArgsBlock(readFileSync(OSS_MUTATION, "utf-8"), "pushStatus");
      const prod = parseArgsBlock(readFileSync(PROD_MUTATION, "utf-8"), "pushStatus");

      const drifted: string[] = [];
      for (const [name, ossExpr] of oss) {
        const prodExpr = prod.get(name);
        if (prodExpr === undefined) continue; // covered by the field-set test
        // Whitespace-collapsed: the same nested `v.object(...)` is wrapped
        // across different line counts in the two files.
        if (prodExpr.replace(/\s+/g, "") !== ossExpr.replace(/\s+/g, "")) {
          drifted.push(`  ${name}\n    oss:  ${ossExpr}\n    prod: ${prodExpr}`);
        }
      }

      expect(
        drifted,
        "these validators differ in shape between the twins. A lost " +
          "`v.optional(...)` takes every agent that omits the field offline; a " +
          "widened validator lets a shape through on one deployment and not the " +
          "other:\n" + drifted.join("\n"),
      ).toEqual([]);
    },
  );

  it.skipIf(!prodPresent)(
    "the cmd_droneStatus table declares the same columns in both twins",
    () => {
      const oss = parseSchemaTableKeys(readFileSync(OSS_SCHEMA, "utf-8"));
      const prod = parseSchemaTableKeys(readFileSync(PROD_SCHEMA, "utf-8"));
      const onlyOss = [...oss].filter((k) => !prod.has(k)).sort();
      const onlyProd = [...prod].filter((k) => !oss.has(k)).sort();
      expect({ onlyOss, onlyProd }).toEqual({ onlyOss: [], onlyProd: [] });
    },
  );

  it.skipIf(!prodPresent)(
    "getCloudStatus checks drone ownership in BOTH twins",
    () => {
      // The exposure gate cannot see this: both are declared `query`, so it
      // passes while one of them returns any node's full status row to any
      // caller who knows a deviceId.
      for (const [label, file] of [
        ["oss", OSS_MUTATION],
        ["prod", PROD_MUTATION],
      ] as const) {
        const text = readFileSync(file, "utf-8");
        const idx = text.indexOf("export const getCloudStatus");
        expect(idx, `${label}: getCloudStatus not found`).toBeGreaterThan(-1);
        // The handler body up to the next top-level export.
        const next = text.indexOf("\nexport const ", idx + 1);
        const body = text.slice(idx, next < 0 ? text.length : next);
        expect(
          body,
          `${label}: getCloudStatus must gate on drone ownership — without it, ` +
            "knowing a deviceId is enough to read that node's whole status row",
        ).toContain("requireOwnedDroneByDeviceId");
      }
    },
  );

  it("every pushStatus arg is picked by the OSS /agent/status route", () => {
    // The third surface the twins hide: this route builds `statusPayload` by
    // picking fields one at a time (production spreads the body instead), so a
    // validator added without a matching pick is a field the OSS deployment can
    // never receive — a reader with no producer, one layer up.
    const args = parseArgsBlock(readFileSync(OSS_MUTATION, "utf-8"), "pushStatus");
    const http = readFileSync(OSS_HTTP, "utf-8");

    // Server-stamped / route-supplied fields never come off the body, plus the
    // five the route deliberately does not forward because the cloud heartbeat
    // does not carry them (see the comment beside `pluginInventory` in
    // `convex/http.ts`). Every other declared arg MUST be picked; the list is
    // asserted below so a sixth entry has to be added on purpose.
    const NOT_FROM_BODY: Record<string, true> = {
      updatedAt: true,
      apiKey: true,
      agentVersion: true,
      peripherals: true,
      scripts: true,
      peers: true,
      enrollment: true,
      logs: true,
    };
    expect(Object.keys(NOT_FROM_BODY).sort()).toEqual([
      "agentVersion",
      "apiKey",
      "enrollment",
      "logs",
      "peers",
      "peripherals",
      "scripts",
      "updatedAt",
    ]);
    const missing = [...args.keys()].filter(
      (name) =>
        !NOT_FROM_BODY[name] &&
        !http.includes(`"${name}"`) &&
        !http.includes(`${name}:`),
    );

    expect(
      missing,
      "these args are declared on pushStatus but never picked in convex/http.ts, " +
        "so the OSS deployment cannot receive them however the agent emits them",
    ).toEqual([]);
  });
});
