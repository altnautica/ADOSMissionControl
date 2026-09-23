/**
 * @module fc/parameters/param-filter.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { filterBySearch, buildSearchHaystack, isReadOnly } from "../parameter-grid-utils";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";

const hnt: ParamMetadata = {
  name: "INS_HNTCH_OPTS",
  humanName: "Harmonic Notch Filter options",
  description: "Harmonic Notch Filter options.",
  bitmask: new Map([[0, "Double notch"], [2, "Update at loop rate"]]),
};
const fltmode: ParamMetadata = {
  name: "FLTMODE1",
  humanName: "Flight Mode 1",
  description: "",
  values: new Map([[5, "Loiter"]]),
};

describe("grid search filter", () => {
  const meta = new Map([["INS_HNTCH_OPTS", hnt], ["FLTMODE1", fltmode]]);
  const rows = [{ name: "INS_HNTCH_OPTS" }, { name: "FLTMODE1" }, { name: "nav_rth_altitude" }];
  const hay = buildSearchHaystack(meta, [...meta.keys()]);
  const search = (term: string) => filterBySearch(rows, hay, term).map((r) => r.name);

  it("matches the parameter name in any case", () => {
    expect(search("HNTCH")).toEqual(["INS_HNTCH_OPTS"]);
  });
  it("matches a bitmask bit label", () => {
    expect(search("double notch")).toEqual(["INS_HNTCH_OPTS"]);
  });
  it("matches an enum value label and the human name", () => {
    expect(search("loiter")).toEqual(["FLTMODE1"]);
    expect(search("Flight Mode")).toEqual(["FLTMODE1"]);
  });
  it("matches a lowercase name that has no metadata", () => {
    expect(search("NAV_RTH")).toEqual(["nav_rth_altitude"]);
  });
  it("returns nothing when nothing matches", () => {
    expect(search("zzz")).toEqual([]);
  });
});

describe("isReadOnly", () => {
  const ro: ParamMetadata = { name: "X", humanName: "", description: "", readOnly: true };
  it("honours the metadata ReadOnly flag", () => {
    expect(isReadOnly("COMPASS_DEV_ID", { ...ro, name: "COMPASS_DEV_ID" })).toBe(true);
  });
  it("keeps STAT_RESET writable although the docs mark it ReadOnly", () => {
    expect(isReadOnly("STAT_RESET", { ...ro, name: "STAT_RESET" })).toBe(false);
    expect(isReadOnly("STAT_RESET", undefined)).toBe(false);
  });
  it("locks the statistics counters", () => {
    expect(isReadOnly("STAT_BOOTCNT", undefined)).toBe(true);
  });
});

describe("buildSearchHaystack", () => {
  it("folds labels into a lowercased haystack", () => {
    const meta = new Map([["INS_HNTCH_OPTS", hnt]]);
    const hay = buildSearchHaystack(meta, ["INS_HNTCH_OPTS"]);
    const s = hay.get("INS_HNTCH_OPTS")!;
    expect(s).toContain("double notch");
    expect(s).toContain("update at loop rate");
    expect(s).toBe(s.toLowerCase());
  });
});
