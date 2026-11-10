/**
 * @license GPL-3.0-only
 *
 * The Mode and Launch sheets read their words, ranges and holds from the
 * shared cockpit spec; a picked Mode segment shows as pending until the
 * pilot answers; a fixed-wing shows the avoidance note.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

const requestPilotAction = vi.fn((..._a: unknown[]) => new Promise<{ ok: boolean; err?: string }>(() => {}));
vi.mock("@/lib/input/pilot-stream", async (orig) => ({
  ...(await orig<typeof import("@/lib/input/pilot-stream")>()),
  requestPilotAction: (...a: unknown[]) => requestPilotAction(...a),
}));

import { ModeSheet } from "../ModeSheet";
import { LaunchSheet } from "../LaunchSheet";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { specString } from "@/lib/cockpit/spec-strings";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { useFlightSheetStore } from "@/components/cockpit/flight/flight-sheet";

function pilot(over: Record<string, unknown> = {}) {
  const p = parsePilotState(demoPilotWire(over));
  if (!p) throw new Error("demo pilot wire did not parse");
  return p;
}

beforeEach(() => {
  requestPilotAction.mockClear();
  useFlightSheetStore.setState({ open: null });
});

describe("ModeSheet", () => {
  it("titles and sections come from the spec; no pilot shows the note", () => {
    render(
      <IntlWrapper>
        <ModeSheet droneId="d1" pilot={null} groundStationLink={false} onClose={() => {}} />
      </IntlWrapper>,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(specString("flow.mode.title"));
    expect(screen.getByText(specString("flow.mode.section.who_flies"))).toBeTruthy();
    expect(screen.getByTestId("mode-no-pilot").textContent).toBe(specString("flow.mode.no_pilot"));
  });

  it("a picked profile shows pending at once", () => {
    render(
      <IntlWrapper>
        <ModeSheet droneId="d1" pilot={pilot({ profile: "normal" })} groundStationLink={false} onClose={() => {}} />
      </IntlWrapper>,
    );
    const sport = screen.getByText("Sport");
    fireEvent.click(sport);
    expect(requestPilotAction).toHaveBeenCalledWith("profile:sport", undefined);
    expect(sport.getAttribute("data-pending")).toBe("true");
  });

  it("a fixed-wing shows the avoidance note instead of the segments", () => {
    render(
      <IntlWrapper>
        <ModeSheet droneId="d1" pilot={pilot({ vehicle_class: "fixedwing" })} groundStationLink={false} onClose={() => {}} />
      </IntlWrapper>,
    );
    expect(screen.getByTestId("fixedwing-avoid-note").textContent).toBe(specString("pilot.avoid.fixedwing_note"));
  });

  it("Escape closes it", () => {
    const onClose = vi.fn();
    render(
      <IntlWrapper>
        <ModeSheet droneId="d1" pilot={null} groundStationLink={false} onClose={onClose} />
      </IntlWrapper>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("LaunchSheet", () => {
  it("altitude range and default come from layout.json launch; texts from the spec", () => {
    render(
      <IntlWrapper>
        <LaunchSheet droneId="d1" pilot={pilot()} onClose={() => {}} />
      </IntlWrapper>,
    );
    const range = screen.getByLabelText(specString("flow.launch.alt_m")) as HTMLInputElement;
    expect(Number(range.min)).toBe(layoutSpec.launch.alt_min_m);
    expect(Number(range.max)).toBe(layoutSpec.launch.alt_max_m);
    expect(Number(range.value)).toBe(layoutSpec.launch.alt_default_m);
    expect(screen.getByText(specString("flow.launch.hold_to_launch"))).toBeTruthy();
  });

  it("go-to has no default offset: launch stays unavailable until both are entered", () => {
    render(
      <IntlWrapper>
        <LaunchSheet droneId="d1" pilot={pilot()} onClose={() => {}} />
      </IntlWrapper>,
    );
    fireEvent.click(screen.getByText(specString("flow.launch.after.goto")));
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["", ""]);
    const hold = screen.getByText(specString("flow.launch.hold_to_launch")).closest("button")!;
    expect(hold.disabled).toBe(true);
    fireEvent.change(inputs[0], { target: { value: "5" } });
    fireEvent.change(inputs[1], { target: { value: "0" } });
    expect(hold.disabled).toBe(false);
  });
});
