/**
 * The battery band resolver is the ONE severity source for fleet surfaces, so
 * these tests pin its contract: it follows the operator's configured
 * thresholds (never a hardcoded pair), it uses the alert pipeline's strict
 * comparison, and a missing reading never gets a band.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { batteryBand } from "@/lib/battery-bands";

const DEFAULTS = { warningPct: 30, criticalPct: 20 };

describe("batteryBand", () => {
  it("bands a reading against the given thresholds", () => {
    expect(batteryBand(10, DEFAULTS)).toBe("critical");
    expect(batteryBand(25, DEFAULTS)).toBe("warning");
    expect(batteryBand(80, DEFAULTS)).toBe("good");
  });

  it("matches the alert pipeline's strict comparison at the boundaries", () => {
    // The alert producer fires strictly below the threshold, so exactly-at
    // reads one band better — the tile and the alert must agree.
    expect(batteryBand(20, DEFAULTS)).toBe("warning");
    expect(batteryBand(19.9, DEFAULTS)).toBe("critical");
    expect(batteryBand(30, DEFAULTS)).toBe("good");
    expect(batteryBand(29.9, DEFAULTS)).toBe("warning");
  });

  it("follows the operator's thresholds rather than any built-in pair", () => {
    const raised = { warningPct: 50, criticalPct: 35 };
    expect(batteryBand(34, raised)).toBe("critical");
    expect(batteryBand(45, raised)).toBe("warning");
    expect(batteryBand(60, raised)).toBe("good");
  });

  it("gives no band for a missing reading", () => {
    expect(batteryBand(null, DEFAULTS)).toBeUndefined();
  });
});
