/**
 * @license GPL-3.0-only
 *
 * The supervised lift-off on the cockpit: the pilot's `sequence.liftoff`
 * words show on the launch step strip while it runs, its stop text replaces
 * the error code once it stopped on the ground, and the `airframe_balance`
 * readiness row offers "I rebalanced it", which sends `airframe_reset`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { pillAlerts } from "@/lib/hud/status-pill";
import { specString } from "@/lib/cockpit/spec-strings";
import { setPilotSender } from "@/lib/input/pilot-stream";
import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";
import { LaunchStepStrip } from "../LaunchSteps";
import { StatusPillList } from "../../flight/StatusPillList";
import { FlightGridContext } from "../../flight/flight-context";
import { flightGrid } from "../../flight/flight-grid";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

afterEach(() => {
  cleanup();
  setPilotSender(null);
});

function sequenceWith(liftoff: Record<string, unknown>, error: string | null = null) {
  const p = parsePilotState({
    ...pilotFixture,
    sequence: { step: "takeoff", after: "hold", error, liftoff },
  });
  return p!.sequence;
}

describe("supervised lift-off on the launch strip", () => {
  it("parses sequence.liftoff", () => {
    expect(sequenceWith({ phase: "level", text: "Levelling on the ground", trim: "learned", tilt_deg: 1.5 })?.liftoff).toEqual({
      phase: "level",
      text: "Levelling on the ground",
      trim: "learned",
      tiltDeg: 1.5,
    });
  });

  it("shows the lift-off's words while it runs", () => {
    render(<LaunchStepStrip sequence={sequenceWith({ phase: "level", text: "Levelling on the ground", trim: "probe", tilt_deg: 0 })} />);
    expect(screen.getByTestId("launch-liftoff-text").textContent).toBe("Levelling on the ground");
  });

  it("shows the stop text in place of the error code once stopped", () => {
    const text = "Stopped on the ground: nose-heavy by about 35 mm, move the battery back";
    render(
      <LaunchStepStrip sequence={sequenceWith({ phase: "stopped", text, trim: "learned", tilt_deg: 6 }, "liftoff_tipping")} />,
    );
    expect(screen.getByTestId("launch-liftoff-text").textContent).toBe(text);
    expect(screen.queryByText(/liftoff_tipping/)).toBeNull();
  });
});

describe("airframe balance readiness row", () => {
  const readiness = [
    { id: "airframe_balance", ok: false, severity: "warn" as const, msg: "Rebalance: nose-heavy by about 20 mm (move the pack aft)" },
    { id: "supervised_liftoff", ok: false, severity: "warn" as const, msg: "Level lift-off is off: the flight controller's own take-off runs" },
  ];

  it("renders both rows with their text and sends airframe_reset from the balance row", () => {
    const frames: Array<{ op: string; name?: string; args?: unknown }> = [];
    setPilotSender(((f: { op: string; name?: string; args?: unknown }) => {
      frames.push(f);
      return true;
    }) as never, "d1");
    const alerts = pillAlerts({ alerts: [], readiness, prearm: undefined, storagePct: null, pilotAgeMs: 0 });
    renderWithIntl(
      <FlightGridContext.Provider value={flightGrid({ width: 1280, height: 800, widthClass: "expanded" })}>
        <div className="ados-cockpit" data-testid="flight-screen">
          <StatusPillList listRef={{ current: null }} alerts={alerts} />
        </div>
      </FlightGridContext.Provider>,
    );
    expect(screen.getByText(readiness[0].msg)).toBeTruthy();
    expect(screen.getByText(readiness[1].msg)).toBeTruthy();
    const buttons = screen.getAllByTestId("airframe-reset");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe(specString("readiness.airframe_balance.reset"));
    fireEvent.click(buttons[0]);
    expect(frames).toContainEqual(expect.objectContaining({ op: "action", name: "airframe_reset", args: {} }));
  });
});
