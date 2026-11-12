/**
 * @module cockpit/flight/bottom-left-card-map.test
 * @description The bottom-left card's map face draws the map over the whole
 * card: basemap tiles and the drone marker, with Leaflet sized to the card.
 *
 * The defect this guards was pure layout. The card face centres its child, and
 * the minimap sized itself from custom properties nothing declared any more,
 * so it resolved to an auto box holding only absolutely placed children: 0x0.
 * Leaflet then laid out a zero-size map and the card showed its blurred
 * backdrop with no tiles, drone or route.
 *
 * happy-dom resolves the cascade but does no layout, so the test lays out the
 * map's ancestor chain itself from the real stylesheet: the card's grid
 * rectangle, then each box either fills its containing box (absolute with a
 * zero inset, or 100% of it), takes an explicit pixel size, or is auto, which
 * for every box in this chain (only absolutely placed children) is 0x0. That
 * is the size Leaflet reads, so the real map is drawn at whatever size the
 * real stylesheet gives it.
 *
 * @license GPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lazy, Suspense, type ComponentType } from "react";
import { cleanup, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

// Load the real lazy components (the map and its layers) through Suspense.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    const Lazy = lazy(() =>
      loader().then((m) => {
        const mod = m as { default?: ComponentType };
        return { default: (mod.default ?? m) as ComponentType };
      }),
    );
    return function Dynamic(props: object) {
      return (
        <Suspense fallback={null}>
          <Lazy {...props} />
        </Suspense>
      );
    };
  },
}));

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { BottomLeftCard } from "../BottomLeftCard";
import { FlightGridContext } from "../flight-context";
import { flightGrid, type Rect } from "../flight-grid";

const DRONE = "node:map-card-test";
const LAT = 12.9716;
const LON = 77.5946;

/** Every `.ados-cockpit` rule of the real stylesheet. */
function cockpitCss(): string {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const rules: string[] = [];
  for (const m of css.matchAll(/([^{}]*\.ados-cockpit[^{}]*)\{([^{}]*)\}/g)) {
    rules.push(`${m[1].trim()} { ${m[2]} }`);
  }
  return rules.join("\n");
}

/** The Tailwind utilities on the map's wrappers, as Tailwind defines them. */
const UTILITIES = `
.relative { position: relative; }
.absolute { position: absolute; }
.inset-0 { inset: 0; }
.w-full { width: 100%; }
.h-full { height: 100%; }
`;

type Box = { w: number; h: number };

/** A `NNpx` length, or null for anything else (auto, %, an unresolved var). */
function px(v: string): number | null {
  return /^-?\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : null;
}

/** The laid-out size of `el`, per the rules in the module description. */
function layoutBox(el: Element | null): Box {
  if (!(el instanceof HTMLElement)) return { w: 0, h: 0 };
  // The card: the grid places it with an inline pixel rectangle.
  const iw = px(el.style.width);
  const ih = px(el.style.height);
  if (iw !== null && ih !== null) return { w: iw, h: ih };
  const cs = getComputedStyle(el);
  const fills = cs.position === "absolute" && ["0", "0px"].includes(cs.getPropertyValue("inset"));
  if (fills || (cs.width === "100%" && cs.height === "100%")) return layoutBox(el.parentElement);
  return { w: px(cs.width) ?? 0, h: px(cs.height) ?? 0 };
}

const realW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const realH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
let style: HTMLStyleElement;

beforeAll(() => {
  style = document.createElement("style");
  style.textContent = cockpitCss() + UTILITIES;
  document.head.appendChild(style);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return layoutBox(this).w;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return layoutBox(this).h;
    },
  });
});

afterAll(() => {
  style.remove();
  if (realW) Object.defineProperty(HTMLElement.prototype, "clientWidth", realW);
  if (realH) Object.defineProperty(HTMLElement.prototype, "clientHeight", realH);
});

beforeEach(() => {
  const t = useTelemetryStore.getState();
  t.clear();
  t.gps.push({ timestamp: Date.now(), fixType: 3, satellites: 14, lat: LAT, lon: LON, alt: 900 });
  t.pushPosition({
    timestamp: Date.now(),
    lat: LAT,
    lon: LON,
    alt: 935,
    relativeAlt: 35,
    heading: 99,
    groundSpeed: 4,
    airSpeed: 4,
    climbRate: 0,
  });
});
afterEach(cleanup);

/** Where Leaflet placed an element: a `translate3d` offset, or `left`/`top`
 *  where the browser reports no 3D transforms (happy-dom). */
function leafletPos(el: Element): { x: number; y: number } {
  const s = (el as HTMLElement).style;
  const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(s.transform);
  if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  return { x: parseFloat(s.left || "0"), y: parseFloat(s.top || "0") };
}

describe("bottom-left card map face", () => {
  it.each([
    [1600, 1000],
    [1280, 800],
    [760, 480],
    // Compact: the card is a round chip.
    [580, 360],
  ])("draws tiles and the drone over the whole card at %ix%i", async (w, h) => {
    const grid = flightGrid({ width: w, height: h, widthClass: widthClassFor(w, false) });
    const card = grid.zones.bottom_left_card as Rect;
    const { container } = renderWithIntl(
      <div className="ados-cockpit">
        <FlightGridContext.Provider value={grid}>
          <BottomLeftCard droneId={DRONE} />
        </FlightGridContext.Provider>
      </div>,
    );

    const mapEl = container.querySelector('[data-testid="cockpit-minimap"]');
    expect(mapEl?.getAttribute("data-frame")).toBe("global");
    // The map face takes the card's whole box.
    expect(layoutBox(mapEl)).toEqual({ w: card.w, h: card.h });

    // The first case also pays for loading the lazy map modules.
    const leaflet = await waitFor(
      () => {
        const el = container.querySelector(".leaflet-container");
        expect(el).not.toBeNull();
        return el as HTMLElement;
      },
      { timeout: 10_000 },
    );
    expect({ w: leaflet.clientWidth, h: leaflet.clientHeight }).toEqual({ w: card.w, h: card.h });

    // Basemap tiles, and the drone marker at the centre of the card (the
    // minimap follows the drone; the icon's margin centres it on its point).
    await waitFor(() => expect(container.querySelectorAll("img.leaflet-tile").length).toBeGreaterThan(0), {
      timeout: 5_000,
    });
    const marker = await waitFor(
      () => {
        const el = container.querySelector(".leaflet-marker-pane .leaflet-marker-icon");
        expect(el).not.toBeNull();
        return el as HTMLElement;
      },
      { timeout: 5_000 },
    );
    const at = leafletPos(marker);
    const mapPane = leafletPos(container.querySelector(".leaflet-map-pane")!);
    expect(Math.abs(at.x + mapPane.x - card.w / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.y + mapPane.y - card.h / 2)).toBeLessThanOrEqual(1);
    // The first case loads the lazy map modules, which can outlast the default
    // 5 s budget on a loaded host; the waits above carry their own limits.
  }, 20_000);
});
