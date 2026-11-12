/**
 * @license GPL-3.0-only
 *
 * A setup refusal or blocker reads as spec text whether the engine sends the
 * full key or a bare code, and an unknown code reads as a worded fallback,
 * never the raw code.
 */

import { describe, expect, it } from "vitest";

import { setupRefusalText, setupText } from "../strings";

describe("setupRefusalText", () => {
  it("resolves full keys", () => {
    expect(setupRefusalText("setup.err.armed")).toBe(setupText("setup.err.armed"));
    expect(setupRefusalText("setup.blocker.detecting")).toBe(setupText("setup.blocker.detecting"));
  });

  it("resolves bare codes through setup.err then setup.blocker", () => {
    expect(setupRefusalText("armed")).toBe(setupText("setup.err.armed"));
    expect(setupRefusalText("wizard_running")).toBe(setupText("setup.blocker.wizard_running"));
    expect(setupRefusalText("detecting")).toBe(setupText("setup.blocker.detecting"));
  });

  it("never shows the raw code for an unknown one", () => {
    for (const code of ["not_running", "setup.err.not_running", "setup.blocker.something_new"]) {
      const text = setupRefusalText(code);
      expect(text).not.toContain("not_running");
      expect(text).not.toContain("something_new");
      expect(text).toBe(setupText("setup.err.precondition"));
    }
  });

  it("fills blocker arguments", () => {
    expect(setupRefusalText("battery_low", { pct: 30 })).toBe("Battery below 30 %");
  });
});
