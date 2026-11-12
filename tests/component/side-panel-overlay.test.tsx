/**
 * A side panel in overlay mode floats over the map as a sheet no wider than
 * its parent, instead of taking its width from the map.
 * @license GPL-3.0-only
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SidePanel } from "@/components/ui/side-panel";

afterEach(cleanup);

describe("SidePanel overlay", () => {
  it("docks beside the map by default", () => {
    render(<SidePanel side="right" open width={300} ariaLabel="Inspector">body</SidePanel>);
    const panel = screen.getByRole("complementary", { name: "Inspector" });
    expect(panel.className).toContain("relative");
    expect(panel.style.width).toBe("300px");
  });

  it("floats as a sheet capped at the parent's width", () => {
    render(<SidePanel side="right" open overlay width={300} ariaLabel="Inspector">body</SidePanel>);
    const panel = screen.getByRole("complementary", { name: "Inspector" });
    expect(panel.className).toContain("absolute");
    expect(panel.className).toContain("right-0");
    // A fixed 300 px would push past a 412 px phone's map; the sheet caps at 100%.
    expect(panel.style.width).not.toBe("300px");
  });
});
