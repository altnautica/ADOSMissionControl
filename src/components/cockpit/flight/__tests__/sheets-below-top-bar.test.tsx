/**
 * @license GPL-3.0-only
 *
 * Every sheet, popover, dialog and scrim on the flight screen starts below
 * the top bar (layout.json `sheets`), so STOP takes the first press with any
 * of them open: the side sheets (camera, mode, launch), the follow range
 * sheet, the Menu, the layer switches, the link and navigation popovers,
 * the command palette and the extension settings drawer.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { flightGrid, type FlightGrid } from "../flight-grid";
import { sheetPlacement, useFlightSheetStore } from "../flight-sheet";
import { LayerLevelButton } from "../../layers/LayerLevelButton";
import { NavSourceChip } from "../../NavSourceChip";
import { CockpitCommandPalette } from "../../CockpitCommandPalette";
import { CockpitQuickSettings } from "../../CockpitQuickSettings";

const CLASSES = [
  [580, 360, "compact"],
  [760, 480, "medium"],
  [1280, 800, "expanded"],
  [1920, 1080, "tv"],
] as const;

const BAR_VAR_TOP = "var(--fs-bar-b, 0px)";

function barBottom(grid: FlightGrid): number {
  const bar = grid.zones.top_bar!;
  return bar.y + bar.h;
}

/** A sheet top as the browser resolves it on this grid. */
function resolveTop(top: unknown, grid: FlightGrid): number {
  if (typeof top === "number") return top;
  const m = String(top).match(/^calc\(var\(--fs-bar-b, 0px\) \+ (\d+)px\)$/);
  if (m) return barBottom(grid) + Number(m[1]);
  if (top === BAR_VAR_TOP) return barBottom(grid);
  throw new Error(`unresolved top ${String(top)}`);
}

/** The flight-screen rules of the real stylesheet. */
function cockpitCss(): string {
  return readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("sheets start below the top bar and leave STOP's centre uncovered", () => {
  it("names the top bar as the sheets' top inset and STOP as never covered", () => {
    expect(layoutSpec.sheets.top_inset).toBe("top_bar");
    expect(layoutSpec.sheets.never_cover_zones).toContain("stop");
  });

  it.each(CLASSES)("side and follow sheets at %ix%i (%s)", (w, h, cls) => {
    const grid = flightGrid({ width: w, height: h, widthClass: cls, following: true });
    const stopCentreY = grid.stop.y + grid.stop.h / 2;
    for (const side of ["left", "right"] as const) {
      const top = resolveTop(sheetPlacement(grid, side).top, grid);
      expect(top, side).toBeGreaterThanOrEqual(barBottom(grid));
      expect(top, side).toBeGreaterThan(stopCentreY);
    }
    const strip = grid.zones.follow_strip;
    if (strip) expect(strip.y + strip.h + 8).toBeGreaterThan(barBottom(grid));
  });

  it("drops the Menu and the layer switches from the bar's bottom edge", () => {
    const css = cockpitCss();
    for (const cls of ["fs-menu", "fs-layer-menu"]) {
      const rule = css.match(new RegExp(`\\.ados-cockpit \\.${cls} \\{([^}]*)\\}`))?.[1] ?? "";
      expect(rule, cls).toMatch(/position: absolute/);
      expect(rule, cls).toMatch(/top: calc\(100% \+ 8px\)/);
    }
  });

  describe("rendered", () => {
    beforeEach(() => useFlightSheetStore.setState({ open: null }));
    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
    });

    it("anchors the layer switches to the bar, not to the 32 px button inside it", () => {
      renderWithIntl(
        <div className="ados-cockpit">
          <div data-zone="top_bar" className="fs-bar">
            <LayerLevelButton droneId="sheets-layers" />
          </div>
        </div>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Choose layers" }));
      const menu = screen.getByTestId("layer-menu");
      expect(menu.className).toContain("fs-layer-menu");
      expect(menu.className).not.toMatch(/\btop-full\b/);
      expect(screen.getByTestId("layer-level-button").className).not.toMatch(/\brelative\b/);
    });

    it("opens the navigation popover below the bar even when the chip sits higher", () => {
      const rects: Record<string, Partial<DOMRect>> = {
        bar: { top: 8, bottom: 66, left: 8, right: 1912, width: 1904, height: 58 },
        chip: { top: 20, bottom: 54, left: 400, right: 480, width: 80, height: 34 },
        root: { top: 0, bottom: 1080, left: 0, right: 1920, width: 1920, height: 1080 },
      };
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const key = this.matches("[data-zone='top_bar']")
          ? "bar"
          : this.classList.contains("ados-cockpit")
            ? "root"
            : "chip";
        return rects[key] as DOMRect;
      });
      renderWithIntl(
        <div className="ados-cockpit">
          <div data-zone="top_bar">
            <NavSourceChip droneId="sheets-nav" />
          </div>
        </div>,
      );
      fireEvent.click(screen.getByTestId("cockpit-nav").querySelector("button")!);
      const pop = screen.getByTestId("nav-source-popover");
      expect(parseFloat(pop.style.top)).toBeGreaterThanOrEqual(66);
    });

    it("starts the command palette's scrim below the bar", () => {
      renderWithIntl(<CockpitCommandPalette droneId="sheets-palette" onClose={() => {}} />);
      const scrim = screen.getByTestId("command-palette-scrim");
      expect(scrim.style.top).toBe(BAR_VAR_TOP);
      expect(scrim.className).not.toMatch(/\binset-0\b/);
    });

    it("starts the extension settings drawer and its scrim below the bar", () => {
      const { container } = renderWithIntl(<CockpitQuickSettings droneId="sheets-quick" onClose={() => {}} />);
      const layer = container.querySelector("[data-cockpit-layer='quick-settings']") as HTMLElement;
      expect(layer.style.top).toBe(BAR_VAR_TOP);
      expect(layer.className).not.toMatch(/\binset-0\b/);
    });
  });
});
