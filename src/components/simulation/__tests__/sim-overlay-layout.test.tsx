/**
 * @license GPL-3.0-only
 *
 * Simulate's overlays stay out of each other's way on a narrow window: the
 * camera cluster stacks above a transport bar that spans only the map
 * column, and the Map controls start collapsed so they leave the HUD clear.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { SimBottomDock } from "../SimBottomDock";
import { MapControlsPanel } from "../MapControlsPanel";
import { FloatingPanel } from "@/components/ui/floating-panel";

function stubViewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return { matches: width >= min, media: query, addEventListener() {}, removeEventListener() {} };
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Simulate bottom dock", () => {
  it("keeps the bar inside the map column and stacks the cluster above it until the column is wide", () => {
    renderWithIntl(
      <SimBottomDock
        bar={<FloatingPanel docked>bar</FloatingPanel>}
        cluster={<FloatingPanel docked>cluster</FloatingPanel>}
      />,
    );
    const dock = screen.getByTestId("sim-bottom-dock");
    expect(dock.className).toContain("inset-x-4");
    expect(dock.className).toContain("flex-col-reverse");
    expect(dock.className).toContain("@5xl:grid-cols-[1fr_auto_1fr]");
    // Bar first in the DOM, so column-reverse draws the cluster above it.
    expect(dock.firstElementChild).toBe(screen.getByTestId("sim-bottom-dock-bar"));
    expect(screen.getByTestId("sim-bottom-dock-bar").className).toContain("self-stretch");
    expect(screen.getByTestId("sim-bottom-dock-cluster").className).toContain("@5xl:col-start-3");
  });

  it("lays docked panels out in flow instead of pinning them to a corner", () => {
    renderWithIntl(<FloatingPanel docked corner="bottom-right">x</FloatingPanel>);
    const panel = screen.getByText("x");
    expect(panel.className).toContain("relative");
    expect(panel.className).not.toContain("absolute");
    expect(panel.className).not.toContain("right-4");
  });
});

describe("Simulate Map controls", () => {
  it("start collapsed on a narrow window and open from the header", () => {
    stubViewport(1024);
    renderWithIntl(<MapControlsPanel hasIonToken={false} />);
    const header = screen.getByRole("button", { name: /^map$/i });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Quality")).toBeNull();
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Quality")).toBeInTheDocument();
  });

  it("start open on a wide window", () => {
    stubViewport(1440);
    renderWithIntl(<MapControlsPanel hasIonToken={false} />);
    expect(screen.getByRole("button", { name: /^map$/i })).toHaveAttribute("aria-expanded", "true");
  });
});
