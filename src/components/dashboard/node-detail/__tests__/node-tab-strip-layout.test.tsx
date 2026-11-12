/**
 * @module node-detail/node-tab-strip-layout.test
 * @description Layout guard for the node-detail tab strip. A grouped section
 * that may shrink collapses to its min-content width (a multi-word tab's
 * longest word) while its tabs keep full width, so "Carried drones" painted
 * over the next section's label. The DOM has no layout engine here, so the
 * guard pins the classes that prevent it: sections never shrink, tab labels
 * never wrap, and the strip itself scrolls its overflow.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { NodeTabStrip } from "../NodeTabStrip";
import type { SurfaceSpec } from "../surface-types";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/components/plugins/DroneDetailTabHost", () => ({
  DroneDetailTabHeaders: () => null,
}));

const SURFACES: SurfaceSpec[] = [
  { id: "overview", labelKey: "Overview", group: "STATUS", render: () => null },
  { id: "carried", labelKey: "Carried drones", group: "STATUS", render: () => null },
  { id: "radio", labelKey: "Radio", group: "LINK", render: () => null },
  { id: "elrs", labelKey: "RC / ELRS Link", group: "LINK", render: () => null },
  { id: "display", labelKey: "Display", group: "DEVICE", render: () => null },
];

afterEach(cleanup);

describe("NodeTabStrip layout", () => {
  it("keeps grouped sections and multi-word tabs from collapsing into each other", () => {
    render(
      <NodeTabStrip
        surfaces={SURFACES}
        pluginIds={[]}
        visibleTab="overview"
        onSelect={() => {}}
        bareDeviceId="node-1"
        nodeProfile={undefined}
      />,
    );

    const strip = screen.getByRole("tablist");
    expect(strip.className).toContain("overflow-x-auto");
    expect(strip.className).toContain("min-w-0");

    const groups = strip.querySelectorAll(':scope > [role="presentation"]');
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      expect(group.className.split(/\s+/)).toContain("shrink-0");
    }

    for (const label of ["Carried drones", "RC / ELRS Link"]) {
      const tab = screen.getByRole("tab", { name: label });
      expect(tab.className.split(/\s+/)).toEqual(
        expect.arrayContaining(["shrink-0", "whitespace-nowrap"]),
      );
    }
  });

  it("scrolls an overflowing strip sideways on a vertical wheel instead of clipping it", () => {
    render(
      <NodeTabStrip
        surfaces={SURFACES}
        pluginIds={[]}
        visibleTab="overview"
        onSelect={() => {}}
        bareDeviceId="node-1"
        nodeProfile={undefined}
      />,
    );
    const strip = screen.getByRole("tablist");
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: 300 });
    const wheel = new WheelEvent("wheel", { deltaY: 120, cancelable: true, bubbles: true });
    strip.dispatchEvent(wheel);
    expect(strip.scrollLeft).toBe(120);
    expect(wheel.defaultPrevented).toBe(true);
  });
});

describe("NodeTabStrip keeps the selected tab in view", () => {
  it("scrolls only the strip, never the page", () => {
    const pageScroll = vi.fn();
    Element.prototype.scrollIntoView = pageScroll;
    render(
      <NodeTabStrip
        surfaces={SURFACES}
        pluginIds={[]}
        visibleTab="display"
        onSelect={() => {}}
        bareDeviceId="node-1"
        nodeProfile={undefined}
      />,
    );
    expect(pageScroll).not.toHaveBeenCalled();
  });
});
