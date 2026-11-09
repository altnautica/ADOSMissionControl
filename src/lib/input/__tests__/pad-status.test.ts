import { describe, expect, it } from "vitest";

import { shortPadName } from "@/lib/input/pad-status";

describe("shortPadName", () => {
  it("drops the Chromium id decorations", () => {
    expect(shortPadName("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)")).toBe(
      "Wireless Controller",
    );
    expect(shortPadName("Xbox Wireless Controller (Vendor: 045e Product: 0b13)")).toBe(
      "Xbox Wireless Controller",
    );
  });

  it("drops the Firefox vendor-product prefix", () => {
    expect(shortPadName("054c-09cc-Wireless Controller")).toBe("Wireless Controller");
  });

  it("keeps a plain name and returns null for nothing", () => {
    expect(shortPadName("My Pad")).toBe("My Pad");
    expect(shortPadName(null)).toBeNull();
    expect(shortPadName("(STANDARD GAMEPAD Vendor: 054c Product: 09cc)")).toBeNull();
  });
});
