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
import { getSeverity, estimateFlightMinutes } from "../deck-utils";

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

  it("returns normal for an absent GPS fix type", () => {
    // Fix type 0 is "No Fix", below the critical threshold, so a drone that
    // has sent no GPS message used to raise a critical fix alarm.
    expect(getSeverity("gpsFix", undefined)).toBe("normal");
    expect(getSeverity("gpsFix", 0)).toBe("critical");
    // 3 sits on the warning boundary because the comparison is inclusive; 4
    // (DGPS) is the first fix type that reads clean.
    expect(getSeverity("gpsFix", 3)).toBe("warning");
    expect(getSeverity("gpsFix", 4)).toBe("normal");
  });

  it("returns normal for the rest of an absent radio report", () => {
    // These share one RADIO_STATUS message with rssi/remrssi. txbuf is the one
    // that alarmed: a low buffer is critical, so no report read as 0% buffer.
    expect(getSeverity("txbuf", undefined)).toBe("normal");
    expect(getSeverity("noise", undefined)).toBe("normal");
    expect(getSeverity("remnoise", undefined)).toBe("normal");
    expect(getSeverity("rxerrors", undefined)).toBe("normal");
    expect(getSeverity("txbuf", 0)).toBe("critical");
  });

  it("returns normal for an absent HDOP rather than reporting perfect precision", () => {
    expect(getSeverity("gpsHdop", undefined)).toBe("normal");
    expect(getSeverity("gpsHdop", 5)).toBe("critical");
  });

  it("returns normal for an unavailable endurance estimate", () => {
    expect(getSeverity("estFlightMin", undefined)).toBe("normal");
    expect(getSeverity("estFlightMin", 1)).toBe("critical");
  });
});

describe("estimateFlightMinutes when it cannot compute", () => {
  it("returns undefined rather than zero for a full pack just after takeoff", () => {
    // Under 5% consumed the math is unstable, so there is no estimate. Zero
    // here reached the low-endurance threshold and alarmed on a full battery.
    expect(estimateFlightMinutes(98, 50, 20)).toBeUndefined();
    expect(getSeverity("estFlightMin", estimateFlightMinutes(98, 50, 20))).toBe("normal");
  });

  it("returns undefined when there is no battery telemetry at all", () => {
    expect(estimateFlightMinutes(0, 0, 0)).toBeUndefined();
  });

  it("still produces an estimate once enough is consumed", () => {
    const minutes = estimateFlightMinutes(50, 1000, 20);
    expect(minutes).toBeGreaterThan(0);
  });
});
