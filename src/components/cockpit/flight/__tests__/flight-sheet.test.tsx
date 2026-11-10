import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent, screen } from "@testing-library/react";
import { useRef } from "react";

vi.mock("next-intl", () => {
  const t = Object.assign((k: string) => k, { has: () => false });
  return { useTranslations: () => t };
});

import {
  sheetPlacement,
  toastAnchor,
  useFlightSheet,
  useFlightSheetStore,
  useSheetDismiss,
} from "../flight-sheet";
import { flightGrid } from "../flight-grid";
import { ConfirmSheet } from "../../confirm/ConfirmSheet";

function Sheet({ id }: { id: string }) {
  const [open, setOpen] = useFlightSheet(id);
  const ref = useRef<HTMLDivElement>(null);
  useSheetDismiss(ref, () => setOpen(false), `[data-sheet-trigger='${id}']`, open);
  return (
    <div>
      <button type="button" data-sheet-trigger={id} onClick={() => setOpen((o) => !o)}>
        open {id}
      </button>
      {open && (
        <div ref={ref} data-testid={`sheet-${id}`}>
          <button type="button">inside {id}</button>
        </div>
      )}
    </div>
  );
}

beforeEach(() => {
  useFlightSheetStore.setState({ open: null });
  document.body.innerHTML = "";
});

describe("flight-screen sheets", () => {
  it("opens one sheet at a time", () => {
    render(
      <>
        <Sheet id="mode" />
        <Sheet id="skills" />
      </>,
    );
    fireEvent.click(screen.getByText("open mode"));
    expect(screen.queryByTestId("sheet-mode")).not.toBeNull();
    fireEvent.click(screen.getByText("open skills"));
    expect(screen.queryByTestId("sheet-mode")).toBeNull();
    expect(screen.queryByTestId("sheet-skills")).not.toBeNull();
  });

  it("closes on Escape and on a press outside, but not inside or on its trigger", () => {
    render(
      <>
        <Sheet id="mode" />
        <p>elsewhere</p>
      </>,
    );
    fireEvent.click(screen.getByText("open mode"));
    fireEvent.pointerDown(screen.getByText("inside mode"));
    expect(screen.queryByTestId("sheet-mode")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("sheet-mode")).toBeNull();

    fireEvent.click(screen.getByText("open mode"));
    // The trigger toggles rather than counting as "outside".
    fireEvent.pointerDown(screen.getByText("open mode"));
    expect(screen.queryByTestId("sheet-mode")).not.toBeNull();
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(screen.queryByTestId("sheet-mode")).toBeNull();
  });

  it("moves focus into an opened sheet", () => {
    render(<Sheet id="mode" />);
    fireEvent.click(screen.getByText("open mode"));
    expect(screen.getByTestId("sheet-mode").contains(document.activeElement)).toBe(true);
  });

  it.each([
    [580, 360, "compact"],
    [760, 480, "medium"],
    [1280, 800, "expanded"],
    [1920, 1080, "expanded"],
  ] as const)("places side sheets clear of the left column and below the top bar at %ix%i", (w, h, cls) => {
    const grid = flightGrid({ width: w, height: h, widthClass: cls });
    const col = grid.zones.left_column!;
    const left = sheetPlacement(grid, "left");
    expect(Number(left.left)).toBeGreaterThanOrEqual(col.x + col.w);
    expect(left.top).toBe("calc(var(--fs-bar-b, 0px) + 8px)");
  });
});

describe("confirm sheet on the flight screen", () => {
  function FlightRoot() {
    return (
      <div data-testid="flight-screen" style={{ ["--fs-bar-b" as string]: "52px" }}>
        <div data-zone="top_bar">
          <button type="button" data-testid="fs-stop">
            STOP
          </button>
        </div>
      </div>
    );
  }

  it("renders inside the flight screen below the top bar over a translucent scrim, never over STOP", () => {
    render(<FlightRoot />);
    useFlightSheetStore.setState({ open: "mode" });
    act(() => {
      render(
        <ConfirmSheet
          policy={{
            title: "Land",
            message: "Land now",
            confirmLabel: "Hold to land",
            variant: "primary",
            gesture: "hold",
            holdMs: 500,
          }}
          droneId="d1"
          onResolve={() => {}}
        />,
      );
    });
    const root = screen.getByTestId("flight-screen");
    const scrim = screen.getByTestId("confirm-scrim");
    expect(root.contains(scrim)).toBe(true);
    expect(scrim.style.top).toBe("var(--fs-bar-b, 0px)");
    expect(scrim.className).toContain("bg-scrim/50");
    expect(scrim.className).not.toContain("fixed");
    expect(scrim.contains(screen.getByTestId("fs-stop"))).toBe(false);
    // Any open flight-screen sheet closes for the confirm.
    expect(useFlightSheetStore.getState().open).toBeNull();
  });

  it("starts below the STOP slot at every landscape class (hit-test on the grid)", () => {
    for (const [w, h, cls] of [
      [580, 360, "compact"],
      [760, 480, "medium"],
      [1280, 800, "expanded"],
      [1920, 1080, "expanded"],
    ] as const) {
      const grid = flightGrid({ width: w, height: h, widthClass: cls });
      const bar = grid.zones.top_bar!;
      const scrimTop = bar.y + bar.h;
      const stopCentreY = grid.stop.y + grid.stop.h / 2;
      expect(stopCentreY).toBeLessThan(scrimTop);
      expect(grid.stop.y + grid.stop.h).toBeLessThanOrEqual(scrimTop);
    }
  });
});

describe("flight-screen toasts", () => {
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it.each([
    [580, 360, "compact", false],
    [760, 480, "medium", false],
    [1280, 800, "expanded", true],
    [1920, 1080, "expanded", false],
    [412, 915, "compact", false],
  ] as const)("stack above the bottom row, clear of the card, skills chip and STOP at %ix%i", (w, h, cls, following) => {
    const grid = flightGrid({ width: w, height: h, widthClass: cls, following });
    const a = toastAnchor(grid);
    // A two-line toast stack 80 px tall above the anchor.
    const stack = { x: a.left, y: h - a.bottom - 80, w: a.width, h: 80 };
    for (const id of ["bottom_row", "bottom_right", "follow_dock", "left_column"] as const) {
      const z = grid.zones[id];
      if (z) expect(overlaps(stack, z), id).toBe(false);
    }
    if (grid.cls !== "portrait") {
      expect(overlaps(stack, grid.zones.bottom_left_card!)).toBe(false);
    }
    expect(overlaps(stack, grid.stop)).toBe(false);
  });
});
