/**
 * @license GPL-3.0-only
 *
 * The Menu inside the real top bar: Flight modes opens the Mode sheet once
 * the Menu has closed, the navigation source moved into the Menu still opens
 * its popover, and with only the link's text moved the Menu lists that text
 * alone while the icon stays on the bar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../CameraSheet", () => ({ CameraPanel: () => <div data-testid="camera-panel" /> }));
vi.mock("../../StickControlChip", () => ({ StickControlChip: () => <div data-testid="stick-control" /> }));

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { FlightTopBar } from "../FlightTopBar";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";
import { useFlightSheetStore } from "../flight-sheet";

const DRONE = "topbar-menu-sheets";

/** Fake layout: the items row needs 100 px plus 60 px per movable item still on the bar. */
let mainWidth = 1000;
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
      <div className="ados-cockpit" data-testid="flight-screen">
        <FlightTopBar droneId={DRONE} />
      </div>
    </FlightGridContext.Provider>,
  );
}

const bar = () => document.querySelector<HTMLElement>("[data-zone='top_bar']")!;

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByTestId("fs-menu-button"));
  return screen.getByTestId("fs-menu");
}

beforeEach(() => {
  useFlightSheetStore.setState({ open: null });
  stubLayout();
});

afterEach(() => {
  cleanup();
  restoreLayout();
  mainWidth = 1000;
  useFlightSheetStore.setState({ open: null });
});

describe("Menu in the top bar", () => {
  it("opens the Mode sheet from Flight modes", () => {
    mount();
    const menu = openMenu();
    fireEvent.click(within(menu).getByTestId("fs-menu-modes"));
    expect(screen.queryByTestId("fs-menu")).toBeNull();
    expect(useFlightSheetStore.getState().open).toBe("mode");
    expect(screen.getByTestId("mode-sheet")).toBeTruthy();
  });

  it("returns focus to the Menu button when Escape closes the Menu", () => {
    mount();
    openMenu();
    expect(document.activeElement).not.toBe(screen.getByTestId("fs-menu-button"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("fs-menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("fs-menu-button"));
  });

  it("opens the pre-flight checklist sheet from the Pre-flight row", () => {
    mount();
    const menu = openMenu();
    fireEvent.click(within(menu).getByTestId("fs-menu-preflight"));
    expect(screen.queryByTestId("fs-menu")).toBeNull();
    expect(useFlightSheetStore.getState().open).toBe("preflight");
    const sheet = screen.getByTestId("preflight-sheet");
    expect(sheet.parentElement).toBe(screen.getByTestId("flight-screen"));
    // A press inside the sheet keeps it open; Escape closes it.
    fireEvent.pointerDown(sheet);
    expect(screen.getByTestId("preflight-sheet")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("preflight-sheet")).toBeNull();
  });

  it("opens the navigation source's popover from the Menu once the chip has moved there", () => {
    // Without controller and nav source the row needs 220 px.
    mainWidth = 250;
    mount();
    expect(bar().getAttribute("data-moved")).toBe("controller nav_source");
    const menu = openMenu();
    const chip = within(menu).getByTestId("cockpit-nav");
    fireEvent.pointerDown(chip.querySelector("button")!);
    fireEvent.click(chip.querySelector("button")!);
    expect(screen.getByTestId("nav-source-popover")).toBeTruthy();
    expect(screen.getByTestId("fs-menu")).toBeTruthy();
    // A press inside the popover keeps both open.
    fireEvent.pointerDown(screen.getByTestId("nav-source-popover"));
    expect(screen.getByTestId("nav-source-popover")).toBeTruthy();
    expect(screen.getByTestId("fs-menu")).toBeTruthy();
  });

  it("keeps focus and the popover's Escape order when the bar re-renders", () => {
    mainWidth = 250;
    const view = mount();
    const menu = openMenu();
    const chip = within(menu).getByTestId("cockpit-nav");
    fireEvent.click(chip.querySelector("button")!);
    const modes = within(menu).getByTestId("fs-menu-modes");
    modes.focus();
    // A fresh grid object re-renders the bar with the same layout.
    view.rerender(
      <FlightGridContext.Provider value={flightGrid({ width: 1280, height: 800, widthClass: "expanded" })}>
        <div className="ados-cockpit" data-testid="flight-screen">
          <FlightTopBar droneId={DRONE} />
        </div>
      </FlightGridContext.Provider>,
    );
    expect(document.activeElement).toBe(modes);
    // Escape closes the popover first; the Menu stays.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("nav-source-popover")).toBeNull();
    expect(screen.getByTestId("fs-menu")).toBeTruthy();
  });

  it("lists only the link's text when its icon is still on the bar", () => {
    // Without controller, nav source and the link text the row needs 160 px.
    mainWidth = 170;
    mount();
    expect(bar().getAttribute("data-moved")).toBe("controller nav_source link_text");
    const menu = openMenu();
    const overflow = within(menu).getByTestId("fs-menu-overflow");
    const items = [...overflow.querySelectorAll(":scope > [data-item]")].map((el) => el.getAttribute("data-item"));
    expect(items).toEqual(["controller", "nav_source", "link_text"]);
    expect(within(overflow).queryByTestId("fs-link-icon")).toBeNull();
    expect(within(overflow).getByTestId("fs-link-detail")).toBeTruthy();
    expect(within(overflow).getByTestId("fs-link-rssi")).toBeTruthy();
    // The icon is drawn once, on the bar.
    expect(screen.getAllByTestId("fs-link-icon")).toHaveLength(1);
  });
});
