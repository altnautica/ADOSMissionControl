/**
 * @license GPL-3.0-only
 *
 * The left column believes only a fresh pilot frame (`pilotFresh`, re-read
 * on its own tick): a frame frozen on the ground no longer hides Land in the
 * air, routes Take off to the pilot, or keeps the launch step strip up. The
 * step strip's Abort says when the pilot refuses it, and a "Launch here"
 * picked more than a few seconds ago is dropped instead of opening Launch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

const pilotAction = vi.hoisted(() =>
  vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true } as { ok: boolean; err?: string })),
);
const stream = vi.hoisted(() => ({ open: true }));
vi.mock("@/lib/input/pilot-stream", async (orig) => ({
  ...(await orig<typeof import("@/lib/input/pilot-stream")>()),
  requestPilotAction: (...a: unknown[]) => pilotAction(...a),
  pilotStreamOpen: () => stream.open,
}));
const activate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/skills", async (orig) => ({
  ...(await orig<typeof import("@/lib/skills")>()),
  activate: (...a: unknown[]) => activate(...a),
  buildSkillContext: () => ({}),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/toast")>()),
  useToast: () => ({ toast }),
}));

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import messages from "../../../../../locales/en.json";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { refusalText } from "@/lib/hud/refusal";
import { specBuiltin } from "@/lib/cockpit/spec-builtins";
import { specString } from "@/lib/cockpit/spec-strings";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useDroneStore } from "@/stores/drone-store";
import { useLaunchRequestStore } from "@/stores/launch-request-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { forgetDrone, noteFcLandedState } from "@/lib/skills/flight-facts";
import { FlightGridContext } from "@/components/cockpit/flight/flight-context";
import { flightGrid } from "@/components/cockpit/flight/flight-grid";
import { useFlightSheetStore } from "@/components/cockpit/flight/flight-sheet";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { LeftColumn } from "../LeftColumn";

const DRONE = "left-col-fresh";

function setPilot(over: Record<string, unknown>, ageMs: number) {
  const p = parsePilotState(demoPilotWire(over));
  if (!p) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, p, Date.now() - ageMs);
}

function mount() {
  const grid = flightGrid({ width: 1280, height: 800, widthClass: widthClassFor(1280, false) });
  return renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <LeftColumn droneId={DRONE} />
    </FlightGridContext.Provider>,
  );
}

const button = (id: string) => screen.queryByLabelText(specBuiltin(id).label);

beforeEach(() => {
  vi.useFakeTimers();
  stream.open = true;
  useFlightSheetStore.setState({ open: null });
  useLaunchRequestStore.setState({ pending: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useNavStreamStore.getState().clear(DRONE);
  useDroneStore.setState({ armState: "disarmed" } as never);
  forgetDrone(DRONE);
  pilotAction.mockReset();
  pilotAction.mockImplementation(() => Promise.resolve({ ok: true }));
  activate.mockClear();
  toast.mockClear();
});

describe("left column and a stale pilot frame", () => {
  it("shows Land when armed and airborne though a 3 s old frame still says landed", () => {
    useDroneStore.setState({ armState: "armed" } as never);
    // EXTENDED_SYS_STATE: MAV_LANDED_STATE_IN_AIR.
    noteFcLandedState(DRONE, 2);
    setPilot({ armed: true, landed: true }, 3000);
    mount();
    expect(button("land")).not.toBeNull();
    expect(button("takeoff")).toBeNull();
  });

  it("armed with unknown landed state shows Land", () => {
    useDroneStore.setState({ armState: "armed" } as never);
    mount();
    expect(button("land")).not.toBeNull();
    expect(button("takeoff")).toBeNull();
  });

  it("a fresh frame with an unknown arm state may be airborne: Land, not Take off", () => {
    // The FC's last word was a disarm; the pilot no longer hears it.
    setPilot({ armed: null, landed: null }, 0);
    mount();
    expect(button("land")).not.toBeNull();
    expect(button("takeoff")).toBeNull();
  });

  it("an unknown FC arm state with a stale frame may be airborne: Land, not Take off", () => {
    useDroneStore.setState({ armState: "unknown" } as never);
    setPilot({ armed: false, landed: true }, 3000);
    mount();
    expect(button("land")).not.toBeNull();
    expect(button("takeoff")).toBeNull();
  });

  it("an unknown FC arm state with no pilot may be airborne: Land, not Take off", () => {
    useDroneStore.setState({ armState: "unknown" } as never);
    mount();
    expect(button("land")).not.toBeNull();
    expect(button("takeoff")).toBeNull();
  });

  it("sends Take off to the built-in, not the Launch sheet, once the frame is stale", () => {
    setPilot({ armed: false, landed: true }, 3000);
    mount();
    fireEvent.click(button("takeoff")!);
    expect(screen.queryByTestId("launch-sheet")).toBeNull();
    expect(activate).toHaveBeenCalledWith("takeoff", expect.anything());
  });

  it("drops the running step strip as the frame crosses 2 s with no new frame", () => {
    setPilot({ sequence: { step: "takeoff", after: null, error: null } }, 1000);
    mount();
    expect(screen.queryByTestId("launch-steps-running")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1100));
    expect(screen.queryByTestId("launch-steps-running")).toBeNull();
  });
});

describe("step strip Abort", () => {
  it("shows the pilot's refusal", async () => {
    pilotAction.mockImplementation(() => Promise.resolve({ ok: false, err: "busy" }));
    setPilot({ sequence: { step: "takeoff", after: null, error: null } }, 0);
    mount();
    fireEvent.click(screen.getByTestId("launch-steps-abort"));
    await act(async () => {});
    expect(pilotAction).toHaveBeenCalledWith("pause");
    expect(toast).toHaveBeenCalledWith(specString("flow.launch.abort_refused", { reason: refusalText("busy") }), "error");
  });
});

describe("Launch here", () => {
  it("opens Launch for a point picked just now", () => {
    setPilot({ armed: false, landed: true }, 0);
    useLaunchRequestStore.getState().requestLaunch({ droneId: DRONE, lat: 1, lon: 1, north: 5, east: 0 });
    mount();
    expect(screen.queryByTestId("launch-sheet")).not.toBeNull();
  });

  it("drops a point picked more than 5 s ago", () => {
    setPilot({ armed: false, landed: true }, 0);
    useLaunchRequestStore.setState({
      pending: { droneId: DRONE, lat: 1, lon: 1, north: 5, east: 0, at: Date.now() - 6000 },
    });
    mount();
    expect(screen.queryByTestId("launch-sheet")).toBeNull();
    expect(useLaunchRequestStore.getState().pending).toBeNull();
  });

  it("consume returns nothing for a stale request", () => {
    useLaunchRequestStore.setState({
      pending: { droneId: DRONE, lat: 1, lon: 1, at: Date.now() - 6000 },
    });
    expect(useLaunchRequestStore.getState().consume()).toBeNull();
    expect(useLaunchRequestStore.getState().pending).toBeNull();
  });
});

describe("Fly this mission", () => {
  const NO_PILOT_TEXT = messages.flightScreen.flyMissionNoPilot;

  it("opens Launch when the drone's pilot is reachable", () => {
    setPilot({ armed: false, landed: true }, 0);
    useLaunchRequestStore.getState().requestLaunch({ droneId: DRONE, after: "mission" });
    mount();
    expect(screen.queryByTestId("launch-sheet")).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("says why Launch did not open on a drone with no pilot stream", () => {
    stream.open = false;
    useLaunchRequestStore.getState().requestLaunch({ droneId: DRONE, after: "mission" });
    mount();
    expect(screen.queryByTestId("launch-sheet")).toBeNull();
    expect(useLaunchRequestStore.getState().pending).toBeNull();
    expect(toast).toHaveBeenCalledWith(NO_PILOT_TEXT, "warning");
  });

  it("stays quiet when a map point is dropped for want of the pilot", () => {
    stream.open = false;
    useLaunchRequestStore.getState().requestLaunch({ droneId: DRONE, lat: 1, lon: 1 });
    mount();
    expect(toast).not.toHaveBeenCalled();
  });
});
