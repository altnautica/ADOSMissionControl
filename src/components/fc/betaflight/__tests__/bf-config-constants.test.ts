/**
 * @module fc/betaflight/bf-config-constants.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { featureDefsForApi } from "../bf-config-constants";

/** features_e bit positions in config/feature.h of current releases (4.3+). */
const CURRENT_FEATURE_BITS = new Set([0, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 25, 27, 28]);

describe("featureDefsForApi", () => {
  it("offers only bits current firmware defines (MSP API 1.46)", () => {
    const defs = featureDefsForApi({ major: 1, minor: 46 });
    for (const d of defs) expect(CURRENT_FEATURE_BITS.has(d.bit), d.label).toBe(true);
    expect(defs.some((d) => d.label === "DYNAMIC_FILTER")).toBe(false);
  });

  it("keeps DYNAMIC_FILTER for firmware before its removal (MSP API 1.43)", () => {
    expect(featureDefsForApi({ major: 1, minor: 43 }).some((d) => d.bit === 29)).toBe(true);
  });

  it("leaves removed bits out when the API version is unknown", () => {
    expect(featureDefsForApi(undefined).some((d) => d.bit === 29)).toBe(false);
  });

  it("never offers bit 1, which no supported release defines", () => {
    expect(featureDefsForApi({ major: 1, minor: 40 }).some((d) => d.bit === 1)).toBe(false);
  });
});
