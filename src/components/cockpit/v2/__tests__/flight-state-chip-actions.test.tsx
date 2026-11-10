/**
 * @license GPL-3.0-only
 *
 * The flight-state chip's button: Abort while a launch runs (the same pause
 * action as the launch step strip's Abort), Resume while the pilot holds a
 * paused mission, with the secondary lines (FAILSAFE, the paused mission)
 * shown. Labels come from the spec strings.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

const pilotAction = vi.hoisted(() =>
  vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true } as { ok: boolean; err?: string })),
);
vi.mock("@/lib/input/pilot-stream", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestPilotAction: pilotAction,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useToast: () => ({ toast }),
}));

import { FlightStateChip } from "../FlightStateChip";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { refusalText } from "@/lib/hud/refusal";
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
  pilotAction.mockReset();
  pilotAction.mockImplementation(() => Promise.resolve({ ok: true }));
  toast.mockClear();
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

  it("shows a refused Abort as the launch sheet does", async () => {
    pilotAction.mockImplementation(() => Promise.resolve({ ok: false, err: "busy" }));
    mount({ sequence: { step: "takeoff", after: null, error: null } });
    fireEvent.click(screen.getByTestId("chip-action"));
    await act(async () => {});
    expect(pilotAction).toHaveBeenCalledWith("pause");
    expect(toast).toHaveBeenCalledWith(specString("flow.launch.abort_refused", { reason: refusalText("busy") }), "error");
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
