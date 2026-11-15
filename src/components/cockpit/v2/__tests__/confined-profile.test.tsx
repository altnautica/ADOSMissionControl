/**
 * @license GPL-3.0-only
 *
 * The confined-place profile on the flight screen, from the agent's golden
 * confined frame: the Confined chip with its route-check report and the speed
 * cap near the clearance limit, and the Launch sheet's place picker, which
 * sends the class to the pilot, waits until the pilot flies with it and does
 * not launch a route the pilot found too tight. The planner's "Fly this
 * mission" carries the plan's class to the sheet.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import { ConfinedChip } from "@/components/cockpit/flight/ConfinedChip";
import { LaunchSheet } from "../LaunchSheet";
import { flyThisMission } from "@/components/planner/fly-this-mission";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { refusalText } from "@/lib/hud/refusal";
import { setPilotSender, type PilotOutboundFrame } from "@/lib/input/pilot-stream";
import { specString } from "@/lib/cockpit/spec-strings";
import { demoPilotWire } from "@/mock/mock-pilot-wire";
import { useLaunchRequestStore } from "@/stores/launch-request-store";
import { useMissionStore } from "@/stores/mission-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import confinedFrame from "@/lib/cockpit/layers/fixtures/pilot-frame-confined.json";

const DRONE = "confined-test";

function golden(over: Record<string, unknown> = {}): PilotState {
  const pilot = parsePilotState({ ...confinedFrame, ...over });
  if (!pilot) throw new Error("golden confined frame did not parse");
  return pilot;
}

function openPilot(): PilotState {
  const pilot = parsePilotState(demoPilotWire({}));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  return pilot;
}

function captureActions(): string[] {
  const sent: string[] = [];
  setPilotSender((f: PilotOutboundFrame) => {
    if (f.op === "action") sent.push(f.name);
    return true;
  }, DRONE);
  return sent;
}

function mountChip(pilot: PilotState) {
  useNavStreamStore.getState().setPilot(DRONE, pilot);
  return render(
    <IntlWrapper>
      <ConfinedChip droneId={DRONE} />
    </IntlWrapper>,
  );
}

function mountSheet(pilot: PilotState) {
  return render(
    <IntlWrapper>
      <LaunchSheet droneId={DRONE} pilot={pilot} onClose={() => {}} />
    </IntlWrapper>,
  );
}

beforeEach(() => {
  useLaunchRequestStore.setState({ pending: null });
});

afterEach(() => {
  cleanup();
  setPilotSender(null);
  useNavStreamStore.getState().clear(DRONE);
  useMissionStore.setState({ placeClass: "open" });
});

describe("Confined chip and route-check report", () => {
  it("shows Confined from the golden frame, its dot in the route check's state", () => {
    mountChip(golden());
    const chip = screen.getByTestId("confined-chip");
    expect(chip.textContent).toBe("Confined");
    expect(chip.getAttribute("data-route-check")).toBe("infeasible");
  });

  it("opens the report: the tight leg, its clearance and need, where it is, and the cap", () => {
    mountChip(golden());
    fireEvent.click(screen.getByRole("button", { name: /Confined/ }));
    const report = screen.getByTestId("route-check");
    expect(report.getAttribute("data-severity")).toBe("critical");
    expect(screen.getByTestId("route-check-line").textContent).toBe("Route too tight: leg 3→4 has 0.52 m, needs 0.58 m");
    expect(screen.getByTestId("route-check-pinch").textContent).toBe("At N 41.3 m, E -17.5 m, height 2.0 m");
    expect(screen.getByTestId("route-check-cap").textContent).toBe("Near the clearance limit: 0.5 m/s max");
  });

  it.each([
    ["feasible", "Route clear · keeps 0.58 m"],
    ["unverified", "Route not seen yet · slow near walls"],
  ])("reads a %s route check", (state, line) => {
    const rc = { ...confinedFrame.route_check, state };
    mountChip(golden({ route_check: rc }));
    fireEvent.click(screen.getByRole("button", { name: /Confined/ }));
    expect(screen.getByTestId("route-check-line").textContent).toBe(line);
  });

  it("shows nothing in an open place", () => {
    mountChip(golden({ place_class: "open", route_check: null }));
    expect(screen.queryByTestId("confined-chip")).toBeNull();
  });

  it("reads the confined refusals through the refusal table", () => {
    expect(refusalText("route_infeasible")).toBe("Route too tight for the confined profile");
    expect(refusalText("no_prop_radius")).toBe("Set the vehicle's outer radius (props, guards or cage) for the confined profile");
    expect(refusalText("no_stall")).toBe("No stalled waypoint to skip");
  });
});

describe("Launch sheet place class", () => {
  it("follows a confined pilot and does not launch a route too tight", () => {
    const sent = captureActions();
    mountSheet(golden());
    expect(screen.getByTestId("place-class-picker").getAttribute("data-value")).toBe("confined");
    // The pilot's own margin from its route check.
    expect(screen.getByTestId("place-class-explain").textContent).toBe(
      specString("flow.launch.place_class.explain_confined", { margin_m: "0.48" }),
    );
    expect(screen.getByTestId("route-check-line").textContent).toBe("Route too tight: leg 3→4 has 0.52 m, needs 0.58 m");
    expect(screen.getByTestId("launch-route-refusal").textContent).toBe(refusalText("route_infeasible"));
    expect(screen.getByText(specString("flow.launch.hold_to_launch")).closest("button")!.disabled).toBe(true);
    expect(sent).toEqual([]);
  });

  it("sends the class the operator picks, and Launch waits until the pilot flies with it", () => {
    const sent = captureActions();
    mountSheet(openPilot());
    expect(screen.getByTestId("place-class-explain").textContent).toBe("Open sites: 1.5 m from obstacles.");
    expect(screen.queryByTestId("place-class-pending")).toBeNull();
    fireEvent.click(screen.getByTestId("place-class-confined"));
    expect(sent).toEqual(["place_class:confined"]);
    expect(screen.getByTestId("place-class-pending").textContent).toBe("Place: Open");
    expect(screen.getByText(specString("flow.launch.hold_to_launch")).closest("button")!.disabled).toBe(true);
  });

  it("Fly this mission sets the plan's confined class on the pilot", () => {
    const sent = captureActions();
    useMissionStore.setState({ placeClass: "confined" });
    flyThisMission(DRONE, () => {});
    expect(useLaunchRequestStore.getState().pending).toMatchObject({ after: "mission", placeClass: "confined" });
    mountSheet(openPilot());
    expect(screen.getByTestId("place-class-picker").getAttribute("data-value")).toBe("confined");
    expect(sent).toEqual(["place_class:confined"]);
  });
});
