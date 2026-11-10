/**
 * @license GPL-3.0-only
 *
 * The camera settings sheet follows the flight screen's sheet rules: it
 * renders at the flight screen's root (not inside the right column), beside
 * the right column and below the top bar, carries its own close ✕, and
 * closes on Escape, a press outside and the ✕, while its trigger toggles it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/lib/agent/resolve-agent", () => ({ resolveLocalAgentForDrone: () => null }));
vi.mock("../../CockpitStreamTabs", () => ({ CockpitStreamTabs: () => <div data-testid="stream-tabs" /> }));
vi.mock("@/components/vision/CockpitCameraRoster", () => ({
  CockpitCameraRoster: () => <div data-testid="camera-roster" />,
}));
vi.mock("../../CockpitDemoStream", () => ({ useDemoFeedActive: () => false }));
vi.mock("@/hooks/use-video-frame-age", () => ({ useVideoFrameAge: () => null }));

import { RightColumn } from "../RightColumn";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";
import { useFlightSheetStore } from "../flight-sheet";

const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
let root: HTMLElement;

beforeEach(() => {
  useFlightSheetStore.setState({ open: null });
  root = document.createElement("div");
  root.setAttribute("data-testid", "flight-screen");
  document.body.appendChild(root);
});

afterEach(() => {
  cleanup();
  root.remove();
});

async function openSheet(): Promise<HTMLElement> {
  renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <RightColumn droneId="sheet-drone" />
    </FlightGridContext.Provider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  fireEvent.click(screen.getByTestId("fs-camera_settings"));
  return screen.getByTestId("fs-camera-sheet");
}

describe("camera settings sheet", () => {
  it("renders at the flight screen's root, below the top bar and beside the right column", async () => {
    const sheet = await openSheet();
    expect(sheet.parentElement).toBe(root);
    expect(sheet.closest("[data-zone='right_column']")).toBeNull();
    expect(sheet.style.top).toContain("--fs-bar-b");
    const col = grid.zones.right_column!;
    expect(sheet.style.right).toBe(`${grid.width - col.x + 8}px`);
    expect(sheet.getAttribute("aria-label")).toBe("Camera settings");
    // The camera fields stay in the sheet.
    expect(screen.getByTestId("stream-tabs")).not.toBeNull();
    expect(screen.getByTestId("camera-roster")).not.toBeNull();
  });

  it("closes on Escape", async () => {
    await openSheet();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("fs-camera-sheet")).toBeNull();
    expect(screen.getByTestId("fs-camera_settings").getAttribute("aria-expanded")).toBe("false");
  });

  it("closes from the ✕ in its header", async () => {
    const sheet = await openSheet();
    const close = screen.getByTestId("fs-camera-sheet-close");
    expect(sheet.querySelector("header")?.contains(close)).toBe(true);
    expect(close.getAttribute("aria-label")).toBe("Close");
    expect(parseFloat(close.style.width)).toBeGreaterThanOrEqual(48);
    fireEvent.click(close);
    expect(screen.queryByTestId("fs-camera-sheet")).toBeNull();
  });

  it("closes on a press outside, and the trigger toggles it", async () => {
    await openSheet();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("fs-camera-sheet")).toBeNull();
    const trigger = screen.getByTestId("fs-camera_settings");
    fireEvent.click(trigger);
    expect(screen.queryByTestId("fs-camera-sheet")).not.toBeNull();
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByTestId("fs-camera-sheet")).toBeNull();
  });
});
