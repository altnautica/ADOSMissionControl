/**
 * @license GPL-3.0-only
 *
 * The deck thresholds are all low-value alarms: satellites below 6 is critical,
 * RSSI below 20 is critical. A metric that was never received used to reach
 * those comparisons as 0, so an aircraft with no radio link and no GPS message
 * raised critical alarms and toasted them, describing readings that were never
 * taken. These tests pin that an absent reading carries no threshold verdict,
 * while a genuine low reading still does.
 */

import { describe, it, expect } from "vitest";
import { getSeverity } from "../deck-utils";

describe("getSeverity with an absent reading", () => {
  it("returns normal for an absent satellite count", () => {
    expect(getSeverity("satellites", undefined)).toBe("normal");
  });

  it("returns normal for an absent link strength", () => {
    expect(getSeverity("radioRssi", undefined)).toBe("normal");
    expect(getSeverity("remrssi", undefined)).toBe("normal");
  });

  it("still reports a genuine zero as critical", () => {
    // A radio that reported 0 dBm really is a critical link. Only the absence
    // of a report is exempt.
    expect(getSeverity("radioRssi", 0)).toBe("critical");
    expect(getSeverity("satellites", 0)).toBe("critical");
  });

  it("still reports a genuine low reading as warning", () => {
    expect(getSeverity("satellites", 8)).toBe("warning");
    expect(getSeverity("radioRssi", 30)).toBe("warning");
  });

  it("still reports a healthy reading as normal", () => {
    expect(getSeverity("satellites", 14)).toBe("normal");
    expect(getSeverity("radioRssi", 90)).toBe("normal");
  });

  it("keeps returning normal for NaN, as it did before", () => {
    expect(getSeverity("radioRssi", Number.NaN)).toBe("normal");
  });

  it("returns normal for an absent battery voltage", () => {
    // batteryVoltage takes the per-cell branch before the threshold table, so
    // it needs its own cover.
    expect(getSeverity("batteryVoltage", undefined, { cellCount: 4 })).toBe("normal");
  });
});
