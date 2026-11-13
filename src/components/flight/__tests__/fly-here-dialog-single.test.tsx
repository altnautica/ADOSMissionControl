/**
 * On the flight screen one right-click opens one Fly Here dialog (the flight
 * screen's own; a map pane's instance stays empty), it is a labelled dialog,
 * Escape closes it, and opening another sheet closes it.
 *
 * @license GPL-3.0-only
 */
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { GuidedConfirmDialog } from "@/components/flight/GuidedConfirmDialog";
import { openFlightSheet } from "@/components/cockpit/flight/flight-sheet";
import { useGuidedStore } from "@/stores/guided-store";
import { useDroneManager } from "@/stores/drone-manager";
import { specString } from "@/lib/cockpit/spec-strings";

function FlightScreen() {
  return (
    <div data-testid="flight-screen">
      <GuidedConfirmDialog />
      <GuidedConfirmDialog flightScreenHost />
    </div>
  );
}

function pick(): void {
  act(() =>
    useGuidedStore.getState().showConfirm({ droneId: "d1", lat: 12.9, lon: 77.6, screenX: 0, screenY: 0 }),
  );
}

describe("Fly Here dialog on the flight screen", () => {
  beforeEach(() => {
    useDroneManager.setState({ selectedDroneId: "d1" });
  });
  afterEach(() => {
    cleanup();
    useGuidedStore.setState({ confirmPending: null });
    useDroneManager.setState({ selectedDroneId: null });
  });

  it("opens exactly one labelled dialog", () => {
    renderWithIntl(<FlightScreen />);
    pick();
    const dialogs = screen.getAllByTestId("fly-here-dialog");
    expect(dialogs).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: specString("map.fly_here") })).toBe(dialogs[0]);
  });

  it("stays open through React's development double mount", () => {
    renderWithIntl(
      <StrictMode>
        <FlightScreen />
      </StrictMode>,
    );
    pick();
    expect(screen.getAllByTestId("fly-here-dialog")).toHaveLength(1);
    expect(useGuidedStore.getState().confirmPending).not.toBeNull();
  });

  it("closes on Escape", () => {
    renderWithIntl(<FlightScreen />);
    pick();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryAllByTestId("fly-here-dialog")).toHaveLength(0);
    expect(useGuidedStore.getState().confirmPending).toBeNull();
  });

  it("closes when another flight sheet opens", () => {
    renderWithIntl(<FlightScreen />);
    pick();
    act(() => openFlightSheet("mode"));
    expect(useGuidedStore.getState().confirmPending).toBeNull();
  });
});
