/**
 * @license GPL-3.0-only
 *
 * The top bar moves items into the Menu in the shared spec's order
 * (`top_bar.overflow.to_menu_order`): controller, navigation source, the
 * link's text, the link's icon, the layer button. The chip, the pill, the
 * battery, the Menu and STOP never move; with everything movable in the Menu
 * the bar is marked full (the pill then truncates).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../CameraSheet", () => ({ CameraPanel: () => <div data-testid="camera-panel" /> }));
vi.mock("../../StickControlChip", () => ({ StickControlChip: () => <div data-testid="stick-control" /> }));
vi.mock("../../PreflightChip", () => ({ PreflightChip: () => <div data-testid="preflight-chip" /> }));

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { FlightTopBar, TOP_BAR_OVERFLOW, hiddenAt } from "../FlightTopBar";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";
import { useFlightSheetStore } from "../flight-sheet";

const DRONE = "topbar-overflow";
const SPEC_ORDER = (layoutSpec.zones as unknown as { id: string; overflow?: { to_menu_order: string[] } }[]).find(
  (z) => z.id === "top_bar",
)!.overflow!.to_menu_order;

/** Fake layout: the items row needs 100 px plus 60 px per movable item still on the bar. */
let mainWidth = 300;
const saved: Record<string, PropertyDescriptor | undefined> = {};

function stubLayout(): void {
  saved.clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  saved.scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("fs-bar")) return 1000;
      if (this.classList.contains("fs-bar-main")) return mainWidth;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains("fs-bar-items")) return 0;
      return 100 + 60 * this.querySelectorAll("[data-item]").length;
    },
  });
}

function restoreLayout(): void {
  for (const k of ["clientWidth", "scrollWidth"] as const) {
    const d = saved[k];
    if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  }
}

function mount() {
  const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
  return renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <div className="ados-cockpit">
        <FlightTopBar droneId={DRONE} />
      </div>
    </FlightGridContext.Provider>,
  );
}

const bar = () => document.querySelector<HTMLElement>("[data-zone='top_bar']")!;

beforeEach(() => {
  useFlightSheetStore.setState({ open: null });
  stubLayout();
});

afterEach(() => {
  cleanup();
  restoreLayout();
  mainWidth = 300;
});

describe("top bar overflow order", () => {
  it("follows the spec's to_menu_order", () => {
    expect([...TOP_BAR_OVERFLOW]).toEqual(SPEC_ORDER);
    expect([...TOP_BAR_OVERFLOW]).toEqual(["controller", "nav_source", "link_text", "link_icon", "layer_button"]);
    expect([...hiddenAt(0)]).toEqual([]);
    expect([...hiddenAt(2)]).toEqual(["controller", "nav_source"]);
    expect([...hiddenAt(3)]).toEqual(["controller", "nav_source", "link_text"]);
  });

  it("moves only the controller when that is enough", () => {
    // Four movable items in the row need 340 px; without the controller 280 px fit 300.
    mount();
    expect(bar().getAttribute("data-moved")).toBe("controller");
    expect(bar().getAttribute("data-overflow")).toBe("partial");
    expect(screen.queryByTestId("cockpit-controller-chip")).toBeNull();
    expect(screen.getByTestId("cockpit-nav")).toBeTruthy();
    expect(screen.getByTestId("fs-link-detail")).toBeTruthy();
    expect(screen.getByTestId("layer-level-button")).toBeTruthy();
  });

  it("moves the link's text before its icon, and the layer button last", () => {
    // Without controller and nav source: 220 px; without the link text too: 160 px.
    mainWidth = 170;
    mount();
    expect(bar().getAttribute("data-moved")).toBe("controller nav_source link_text");
    expect(screen.getByTestId("fs-link")).toBeTruthy();
    expect(screen.queryByTestId("fs-link-detail")).toBeNull();
    expect(screen.getByTestId("layer-level-button")).toBeTruthy();
  });

  it("keeps the chip, pill, battery, Menu and STOP when everything movable is in the Menu", () => {
    mainWidth = 10;
    mount();
    expect(bar().getAttribute("data-moved")).toBe(SPEC_ORDER.join(" "));
    expect(bar().getAttribute("data-overflow")).toBe("full");
    for (const id of ["flight-state-chip", "status-pill", "fs-battery", "fs-menu-button", "cockpit-kill"]) {
      expect(screen.getByTestId(id), id).toBeTruthy();
    }
    expect(screen.queryByTestId("fs-link")).toBeNull();
    expect(screen.queryByTestId("layer-level-button")).toBeNull();
    // The truncating pill keeps its full text in a title.
    const pillText = screen.getByTestId("status-pill").querySelector(".fs-pill-text")!;
    expect(pillText.getAttribute("title")).toBe(pillText.textContent);
  });

  it("lists exactly the hidden items in the Menu's overflow section, in the spec's order", () => {
    mainWidth = 10;
    mount();
    fireEvent.click(screen.getByTestId("fs-menu-button"));
    const overflow = screen.getByTestId("fs-menu-overflow");
    const items = [...overflow.querySelectorAll(":scope > [data-item]")].map((el) => el.getAttribute("data-item"));
    expect(items).toEqual(["controller", "nav_source", "link_icon", "layer_button"]);
    expect(within(overflow).getByTestId("fs-link-detail")).toBeTruthy();
  });
});
