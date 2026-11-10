/**
 * @license GPL-3.0-only
 *
 * The tip layer with the real tip queue: a tip with no room beside its
 * anchor never shows and a controller button then marks nothing seen; the
 * status pill's list counts as an open sheet, so no tip draws over it.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import tipsJson from "@/lib/cockpit-spec/tips.json";
import { TipLayer } from "@/components/cockpit/TipLayer";
import { StatusPill } from "@/components/cockpit/flight/StatusPill";
import { useFlightSheetStore } from "@/components/cockpit/flight/flight-sheet";
import { useCockpitTipsStore } from "@/stores/cockpit-tips-store";
import { useControlsStore } from "@/stores/controls-store";
import { useDroneStore } from "@/stores/drone-store";
import { useInputStore } from "@/stores/input-store";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";

interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}

let view: R = { x: 0, y: 0, w: 1000, h: 600 };
/** Boxes for elements that carry no `data-rect` (the real pill). */
const BY_TESTID: Record<string, R> = { "status-pill": { x: 760, y: 8, w: 100, h: 40 } };
const CHIP: R = { x: 400, y: 8, w: 200, h: 40 };

const original = HTMLElement.prototype.getBoundingClientRect;

function advance(ms: number) {
  act(() => void vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const id = this.dataset.testid ?? "";
    const raw = id === "tip-layer" ? JSON.stringify(view) : this.dataset.rect;
    const r: R = raw ? JSON.parse(raw) : (BY_TESTID[id] ?? { x: 0, y: 0, w: 0, h: 0 });
    return { x: r.x, y: r.y, left: r.x, top: r.y, width: r.w, height: r.h, right: r.x + r.w, bottom: r.y + r.h, toJSON: () => r } as DOMRect;
  };
  useCockpitTipsStore.getState().reset();
  useControlsStore.setState({ tourVisible: false });
  useDroneStore.setState({ armState: "disarmed" });
  useFlightSheetStore.setState({ open: null });
  useInputStore.setState({ buttons: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  HTMLElement.prototype.getBoundingClientRect = original;
  view = { x: 0, y: 0, w: 1000, h: 600 };
  useFlightSheetStore.setState({ open: null });
  useInputStore.setState({ buttons: [] });
});

describe("TipLayer with the tip queue", () => {
  it("never marks a tip seen that had no room to show", () => {
    // Too narrow for the panel beside the pill, too short above or below it.
    view = { x: 0, y: 0, w: 240, h: 100 };
    render(
      <div>
        <div data-testid="status-pill" data-rect={JSON.stringify({ x: 70, y: 8, w: 100, h: 40 })}>pill</div>
        <TipLayer droneId="tips-live" />
      </div>,
    );
    advance(tipsJson.rules.first_delay_ms + 500);
    expect(screen.queryByTestId("cockpit-tip")).toBeNull();
    act(() => useInputStore.setState({ buttons: [true] }));
    act(() => useInputStore.setState({ buttons: [] }));
    fireEvent.pointerDown(screen.getByTestId("status-pill"));
    expect(useCockpitTipsStore.getState().seen).toEqual([]);
  });

  it("shows no tip while the status pill's list is open", () => {
    renderWithIntl(
      <div>
        <StatusPill droneId="tips-live" />
        <div data-testid="flight-state-chip" data-rect={JSON.stringify(CHIP)}>chip</div>
        <TipLayer droneId="tips-live" />
      </div>,
    );
    advance(tipsJson.rules.first_delay_ms + 500);
    expect(screen.getByTestId("cockpit-tip").dataset.tip).toBe("status_pill");
    // A tap on the pill dismisses its tip and opens the list.
    const pill = screen.getByTestId("status-pill");
    fireEvent.pointerDown(pill);
    fireEvent.click(pill);
    expect(screen.getByTestId("status-pill-list")).toBeTruthy();
    advance(tipsJson.rules.gap_between_ms + 1_000);
    expect(screen.getByTestId("status-pill-list")).toBeTruthy();
    expect(screen.queryByTestId("cockpit-tip")).toBeNull();
  });
});
