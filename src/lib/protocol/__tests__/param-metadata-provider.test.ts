/**
 * @module protocol/param-metadata-provider.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { mergeMeta, mergeMetaMaps } from "../param-metadata/merge";
import type { ParamMetadata } from "../param-metadata/types";

describe("mergeMeta", () => {
  it("layers overlay fields over the base without losing base fields", () => {
    const base: ParamMetadata = {
      name: "X", humanName: "x", description: "d",
      bitmask: new Map([[0, "A"], [1, "B"]]),
    };
    const overlay: ParamMetadata = {
      name: "X", humanName: "x", description: "d",
      range: { min: 0, max: 10 }, defaultValue: 3,
    };
    const out = mergeMeta(base, overlay);
    expect(out.range).toEqual({ min: 0, max: 10 });
    expect(out.defaultValue).toBe(3);
    expect(out.bitmask?.get(0)).toBe("A"); // base label preserved
  });

  it("does not let an empty overlay Map wipe the base Map", () => {
    const base: ParamMetadata = {
      name: "X", humanName: "", description: "",
      bitmask: new Map([[0, "A"]]),
    };
    const overlay: ParamMetadata = {
      name: "X", humanName: "", description: "", bitmask: new Map(),
    };
    expect(mergeMeta(base, overlay).bitmask?.get(0)).toBe("A");
  });
});

describe("mergeMetaMaps", () => {
  it("adds overlay-only params and field-merges shared ones", () => {
    const base = new Map<string, ParamMetadata>([
      ["A", { name: "A", humanName: "", description: "", units: "m" }],
    ]);
    const overlay = new Map<string, ParamMetadata>([
      ["A", { name: "A", humanName: "", description: "", range: { min: 0, max: 1 } }],
      ["B", { name: "B", humanName: "", description: "" }],
    ]);
    const out = mergeMetaMaps(base, overlay);
    expect(out.get("A")?.units).toBe("m");
    expect(out.get("A")?.range).toEqual({ min: 0, max: 1 });
    expect(out.has("B")).toBe(true);
  });
});
