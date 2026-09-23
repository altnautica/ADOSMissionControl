/**
 * Copy actions must report their outcome and must not throw where the
 * clipboard API is missing (a non-secure http:// origin on the LAN).
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { handleCopyCoords, handleMeasureFromDrone } from "../utility";

const menuPos = { x: 0, y: 0, lat: 47.0012345, lon: 8.0012345 };

function setClipboard(clipboard: Pick<Clipboard, "writeText"> | undefined) {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}

describe("map menu copy actions", () => {
  afterEach(() => setClipboard(undefined));

  it("shows the text instead of throwing when the clipboard API is missing", async () => {
    setClipboard(undefined);
    const report = vi.fn();
    await handleCopyCoords(menuPos, report);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("47.0012345, 8.0012345"), "info");
  });

  it("reports a refused clipboard write with the text", async () => {
    setClipboard({ writeText: () => Promise.reject(new Error("denied")) });
    const report = vi.fn();
    await handleMeasureFromDrone({ distLabel: "120 m", bearingDeg: 44.6, report });
    expect(report).toHaveBeenCalledWith(expect.stringContaining("120 m at 45°"), "warning");
  });

  it("reports a successful copy", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    const report = vi.fn();
    await handleCopyCoords(menuPos, report);
    expect(writeText).toHaveBeenCalledWith("47.0012345, 8.0012345");
    expect(report).toHaveBeenCalledWith(expect.any(String), "success");
  });
});
