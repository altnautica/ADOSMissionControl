/**
 * The Fly Here hold on the flight screen: only the dialog on screen answers
 * Enter or the pad, so a map pane's hidden copy never sends its own altitude,
 * and an open skill confirm (the emergency stop) closes Fly Here so one hold
 * never drives both.
 *
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type * as Skills from "@/lib/skills";

const spies = vi.hoisted(() => ({
  activate: vi.fn(async (_id: string, _ctx: unknown, _args?: unknown) => undefined),
}));

vi.mock("@/lib/skills", async (importOriginal) => ({
  ...(await importOriginal<typeof Skills>()),
  activate: (id: string, ctx: unknown, args?: unknown) => spies.activate(id, ctx, args),
}));

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { GuidedConfirmDialog } from "@/components/flight/GuidedConfirmDialog";
import { SPEC_HOLD_MS } from "@/lib/skills";
import { useDroneManager } from "@/stores/drone-manager";
import { useGuidedStore } from "@/stores/guided-store";
import { useInputStore } from "@/stores/input-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";

/** The flight screen with a map pane's copy mounted ahead of the host. */
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

function holdEnter(): void {
  fireEvent.keyDown(window, { key: "Enter" });
  act(() => vi.advanceTimersByTime(SPEC_HOLD_MS.fly_here + 100));
  fireEvent.keyUp(window, { key: "Enter" });
}

beforeEach(() => {
  vi.useFakeTimers();
  spies.activate.mockClear();
  useDroneManager.setState({ selectedDroneId: "d1" });
  useInputStore.setState({ buttons: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useGuidedStore.setState({ confirmPending: null });
  useSkillConfirmStore.setState({ pending: null });
  useDroneManager.setState({ selectedDroneId: null });
});

describe("Fly Here hold", () => {
  it("sends once, with the altitude typed into the dialog on screen", () => {
    renderWithIntl(<FlightScreen />);
    pick();
    fireEvent.change(screen.getByLabelText(/altitude/i), { target: { value: "50" } });
    holdEnter();
    expect(spies.activate).toHaveBeenCalledTimes(1);
    expect(spies.activate.mock.calls[0][0]).toBe("fly-here");
    expect(spies.activate.mock.calls[0][2]).toMatchObject({ altitudeM: 50 });
  });

  it("sends nothing while the altitude on screen is out of range", () => {
    renderWithIntl(<FlightScreen />);
    pick();
    fireEvent.change(screen.getByLabelText(/altitude/i), { target: { value: "" } });
    holdEnter();
    expect(spies.activate).not.toHaveBeenCalled();
  });

  it("closes when the stop sheet opens, so holding Enter for the stop sends no reposition", () => {
    renderWithIntl(<FlightScreen />);
    pick();
    act(() => {
      void useSkillConfirmStore.getState().request(
        {
          title: "confirm.kill.title",
          message: "confirm.kill.message",
          confirmLabel: "confirm.kill.confirm",
          variant: "danger",
          gesture: "guarded",
          holdMs: SPEC_HOLD_MS.stop,
        },
        "d1",
      );
    });
    expect(screen.queryAllByTestId("fly-here-dialog")).toHaveLength(0);
    expect(useGuidedStore.getState().confirmPending).toBeNull();
    holdEnter();
    expect(spies.activate).not.toHaveBeenCalled();
  });

  it("refuses a new Fly Here offer while a skill confirm shows", () => {
    useSkillConfirmStore.setState({ pending: { id: 1, policy: {} as never, droneId: "d1", resolve: () => {} } });
    renderWithIntl(<FlightScreen />);
    pick();
    expect(screen.queryAllByTestId("fly-here-dialog")).toHaveLength(0);
    expect(useGuidedStore.getState().confirmPending).toBeNull();
    const down: boolean[] = [];
    down[0] = true;
    act(() => useInputStore.setState({ buttons: down }));
    act(() => vi.advanceTimersByTime(SPEC_HOLD_MS.fly_here + 100));
    expect(spies.activate).not.toHaveBeenCalled();
  });
});
