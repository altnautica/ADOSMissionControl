import { describe, expect, it } from "vitest";

import {
  formatCoord,
  formatDecimal,
  formatDistance,
  formatDurationSeconds,
  formatKilometres,
  formatPercent,
} from "@/lib/i18n/format";

describe("format helpers", () => {
  it("formats decimals with English defaults", () => {
    expect(formatDecimal(1234.5678, 2, "en")).toBe("1,234.57");
    expect(formatDecimal(0, 1, "en")).toBe("0.0");
  });

  it("uses comma decimals for German locale", () => {
    expect(formatDecimal(1234.5, 1, "de")).toBe("1.234,5");
  });

  it("returns placeholder for non-finite values", () => {
    expect(formatDecimal(null, 1)).toBe("—");
    expect(formatDecimal(undefined, 1)).toBe("—");
    expect(formatDecimal(Number.NaN, 1)).toBe("—");
    expect(formatDecimal(Number.POSITIVE_INFINITY, 1)).toBe("—");
    expect(formatDecimal(0, 1, "en", "n/a")).toBe("0.0");
    expect(formatDecimal(null, 1, "en", "n/a")).toBe("n/a");
  });

  it("formats distance with auto km switchover", () => {
    expect(formatDistance(450, "en")).toBe("450 m");
    expect(formatDistance(999, "en")).toBe("999 m");
    expect(formatDistance(1000, "en")).toBe("1.0 km");
    expect(formatDistance(1234.56, "en")).toBe("1.23 km");
    expect(formatDistance(null)).toBe("—");
  });

  it("formats percentages from 0..1 ratios", () => {
    expect(formatPercent(0.85, 0, "en")).toBe("85%");
    expect(formatPercent(0.123, 1, "en")).toBe("12.3%");
    expect(formatPercent(null)).toBe("—");
  });

  it("formats kilometre values directly", () => {
    expect(formatKilometres(1.234, 2, "en")).toBe("1.23 km");
    expect(formatKilometres(0, 1, "en")).toBe("0.0 km");
  });

  it("formats durations as m:ss or h:mm:ss", () => {
    expect(formatDurationSeconds(0)).toBe("0:00");
    expect(formatDurationSeconds(45)).toBe("0:45");
    expect(formatDurationSeconds(125)).toBe("2:05");
    expect(formatDurationSeconds(3725)).toBe("1:02:05");
    expect(formatDurationSeconds(null)).toBe("—");
    expect(formatDurationSeconds(-1)).toBe("—");
  });

  it("formats coord pairs with fixed precision, separated so a decimal comma stays unambiguous", () => {
    expect(formatCoord(12.345678, 77.65432, 5, "en")).toBe("12.34568; 77.65432");
    expect(formatCoord(12.345678, 77.65432, 5, "de")).toBe("12,34568; 77,65432");
    expect(formatCoord(null, 1)).toBe("—; 1.00000");
  });
});
