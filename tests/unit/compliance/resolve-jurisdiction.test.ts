import { describe, expect, it } from "vitest";
import { JURISDICTIONS, resolveJurisdiction } from "@/lib/compliance/jurisdictions";

describe("resolveJurisdiction", () => {
  it("keeps a known code", () => {
    expect(resolveJurisdiction("US_FAA_PART107", "IN_DGCA")).toBe("US_FAA_PART107");
  });

  it("falls back for free text, a wrong case or an inherited key, so exporters always get a spec", () => {
    for (const junk of ["DGCA", "us_faa_part107", "toString", ""]) {
      const code = resolveJurisdiction(junk, "IN_DGCA");
      expect(code).toBe("IN_DGCA");
      expect(JURISDICTIONS[code].outputFormats).toBeDefined();
    }
    expect(resolveJurisdiction(undefined, "GENERIC")).toBe("GENERIC");
  });
});
