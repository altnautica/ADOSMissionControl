/**
 * @license GPL-3.0-only
 *
 * The bottom-left card's page dots are touch-size hit areas (`layout.json`
 * `touch_target.min`) at every class, the compact chip included, and on the
 * map face they sit clear of the local map's zoom column.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";

vi.mock("next/dynamic", () => ({
  default: () =>
    function OverviewMapStub() {
      return <div data-testid="overview-map" />;
    },
}));

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import type { CockpitWidthClass } from "@/lib/cockpit/width-class";
import { useMinimapModeStore } from "@/stores/minimap-mode-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { BottomLeftCard, CARD_FACES } from "../BottomLeftCard";
import { FlightGridContext } from "../flight-context";
import { flightGrid, type FlightGrid } from "../flight-grid";

const DRONE = "node:card-hit-targets";
const MIN = layoutSpec.touch_target.min;

/** The stylesheet's flight-screen and local-map rules (no conditional blocks). */
function flightCss(): string {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@(?:supports|media|container)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const rules: string[] = [];
  for (const m of css.matchAll(/([^{}@]*(?:\.ados-cockpit|\.lfmap)[^{}]*)\{([^{}]*)\}/g)) {
    rules.push(`${m[1].trim()} { ${m[2]} }`);
  }
  return rules.join("\n");
}

let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement("style");
  style.textContent = flightCss();
  document.head.appendChild(style);
});
afterAll(() => style.remove());

beforeEach(() => {
  useTelemetryStore.getState().clear();
  useMinimapModeStore.setState({ pinByVehicle: { [DRONE]: "local" } });
});
afterEach(cleanup);

function renderCard(width: number, height: number, widthClass: CockpitWidthClass): FlightGrid {
  const grid = flightGrid({ width, height, widthClass });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div className="ados-cockpit">
        <FlightGridContext.Provider value={grid}>
          <BottomLeftCard droneId={DRONE} />
        </FlightGridContext.Provider>
      </div>
    </NextIntlClientProvider>,
  );
  return grid;
}

/** A computed length in pixels; a percentage resolves against `base`. */
function px(el: Element, prop: string, base = 0): number {
  const v = getComputedStyle(el).getPropertyValue(prop);
  return (v.endsWith("%") ? (parseFloat(v) * base) / 100 : parseFloat(v)) || 0;
}

function card(): HTMLElement {
  return document.querySelector("[data-zone='bottom_left_card']") as HTMLElement;
}

describe("card dot hit areas", () => {
  for (const [w, h, cls] of [
    [1280, 800, "expanded"],
    [900, 600, "medium"],
    [640, 360, "compact"],
  ] as const) {
    it(`are at least ${MIN} px on a ${cls} cockpit`, () => {
      const grid = renderCard(w, h, cls);
      const dots = card().querySelector(".fs-dots") as HTMLElement;
      const rowW = grid.zones.bottom_left_card!.w - px(dots, "left") - px(dots, "right");
      const buttons = dots.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) {
        expect(px(b, "width", rowW)).toBeGreaterThanOrEqual(MIN);
        expect(px(b, "height")).toBeGreaterThanOrEqual(MIN);
      }
    });
  }

  it("steps through every face from the compact chip's dots", () => {
    const grid = renderCard(640, 360, "compact");
    expect(grid.cardIsChip).toBe(true);
    const step = card().querySelector(".fs-dots button") as HTMLElement;
    const seen = [card().getAttribute("data-face")];
    for (let i = 1; i < CARD_FACES.length; i++) {
      fireEvent.click(step);
      seen.push(card().getAttribute("data-face"));
    }
    expect(seen).toEqual([...CARD_FACES]);
  });

  it("keeps the map face's dots clear of the zoom column at medium", () => {
    const grid = renderCard(900, 600, "medium");
    expect(card().getAttribute("data-face")).toBe("map");
    const cardW = grid.zones.bottom_left_card!.w;
    const dots = card().querySelector(".fs-dots") as HTMLElement;
    const buttons = [...dots.querySelectorAll("button")];
    const rowLeft = px(dots, "left");
    const rowW = cardW - rowLeft - px(dots, "right");
    const dotsW = buttons.reduce((sum, b) => sum + px(b, "width"), 0);
    expect(dotsW).toBeLessThanOrEqual(rowW);
    const dotsRight = rowLeft + (rowW + dotsW) / 2;
    const zoom = card().querySelector(".lfmap-zoom button") as HTMLElement;
    expect(zoom).not.toBeNull();
    expect(dotsRight).toBeLessThanOrEqual(cardW - px(zoom, "width"));
  });
});
