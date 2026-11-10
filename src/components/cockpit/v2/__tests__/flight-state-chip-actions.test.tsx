/**
 * @license GPL-3.0-only
 *
 * The flight-state chip's button: Abort while a launch runs (the same pause
 * action as the launch step strip's Abort), Resume while the pilot holds a
 * paused mission, with the secondary lines (FAILSAFE, the paused mission)
 * shown. Labels come from the spec strings.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

const pilotAction = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("@/lib/input/pilot-stream", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestPilotAction: pilotAction,
}));

import { FlightStateChip } from "../FlightStateChip";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { specString } from "@/lib/cockpit/spec-strings";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "chip-actions-test";

function mount(over: Record<string, unknown>) {
  const pilot = parsePilotState(demoPilotWire(over));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot);
  return render(
    <IntlWrapper>
      <FlightStateChip droneId={DRONE} />
    </IntlWrapper>,
  );
}

afterEach(() => {
  useNavStreamStore.getState().clear(DRONE);
  pilotAction.mockClear();
});

describe("FlightStateChip button", () => {
  it("offers Abort on a running launch and aborts like the step strip", () => {
    mount({ sequence: { step: "takeoff", after: null, error: null } });
    expect(screen.getByTestId("flight-state-chip").getAttribute("data-chip")).toBe("launching");
    const action = screen.getByTestId("chip-action");
    expect(action.getAttribute("data-action")).toBe("abort");
    expect(action.textContent).toBe(specString("flow.launch.abort"));
    fireEvent.click(action);
    expect(pilotAction).toHaveBeenCalledWith("pause");
  });

  it("offers Resume while the pilot holds a paused mission, with the paused line", () => {
    mount({ owner: "pilot", mission: { state: "paused", seq: 2, total: 5 } });
    expect(screen.getByTestId("flight-state-chip").getAttribute("data-chip")).toBe("pilot");
    const action = screen.getByTestId("chip-action");
    expect(action.getAttribute("data-action")).toBe("resume");
    expect(action.textContent).toBe(specString("flow.resume"));
    expect(screen.getByTestId("flight-state-chip").textContent).toContain(
      specString("chip.mission_paused_line", { seq: 2, total: 5 }),
    );
  });

  it("shows the FAILSAFE secondary line", () => {
    mount({ owner: "fc_mode", fc_mode: 6, fc_mode_name: "RTL", fc_failsafe: true });
    expect(screen.getByTestId("flight-state-chip").textContent).toContain(specString("chip.failsafe"));
  });
});
