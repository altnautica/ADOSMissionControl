import { describe, it, expect } from "vitest";
import { formatLogTime } from "../LogViewer";

const local = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

describe("formatLogTime", () => {
  it("renders an ISO-8601 string in the same zone as an epoch for the same instant", () => {
    const ms = Date.UTC(2026, 4, 24, 9, 30, 15);
    // The agent rendered the instant with a +05:30 offset; the epoch path and
    // the offset string must read the same wall time.
    expect(formatLogTime("2026-05-24T15:00:15+05:30")).toBe(formatLogTime(ms));
    expect(formatLogTime("2026-05-24T09:30:15+00:00")).toBe(local(ms));
    expect(formatLogTime("2026-05-24T09:30:15.123Z")).toBe(local(ms + 123));
  });

  it("formats a numeric epoch in milliseconds", () => {
    const ms = Date.UTC(2026, 4, 24, 9, 30, 15);
    expect(formatLogTime(ms)).toBe(local(ms));
  });

  it("formats a numeric epoch in seconds", () => {
    const ms = Date.UTC(2026, 4, 24, 9, 30, 15);
    expect(formatLogTime(ms / 1000)).toBe(local(ms));
  });

  it("parses a numeric string as an epoch", () => {
    const ms = Date.UTC(2026, 4, 24, 9, 30, 15);
    expect(formatLogTime(String(ms))).toBe(local(ms));
  });

  it("never throws on malformed input", () => {
    expect(formatLogTime(undefined)).toBe("");
    expect(formatLogTime(null)).toBe("");
    expect(formatLogTime(NaN)).toBe("");
    expect(formatLogTime("")).toBe("");
    expect(formatLogTime("not a date")).toBe("");
    expect(formatLogTime({})).toBe("");
  });
});
