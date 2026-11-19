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
import { handlePilotServerFrame, setPilotSender } from "@/lib/input/pilot-stream";
import { refusalText } from "@/lib/hud/refusal";
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

describe("steady take-off on the launch strip", () => {
  it("parses sequence.liftoff", () => {
    expect(
      sequenceWith({ phase: "level", text: "Setting trim", detail: "Loading this airframe's learned balance", trim: "learned", tilt_deg: 1.5 })
        ?.liftoff,
    ).toEqual({
      phase: "level",
      text: "Setting trim",
      detail: "Loading this airframe's learned balance",
      trim: "learned",
      tiltDeg: 1.5,
    });
    expect(sequenceWith({ phase: "lift", text: "Lifting off", trim: "learned", tilt_deg: 0 })?.liftoff?.detail).toBeNull();
  });

  it("shows the status line, with its detail, while it runs", () => {
    render(<LaunchStepStrip sequence={sequenceWith({ phase: "lift", text: "Lifting off", trim: "probe", tilt_deg: 0 })} />);
    expect(screen.getByTestId("launch-liftoff-text").textContent).toBe("Lifting off");
    cleanup();
    render(
      <LaunchStepStrip
        sequence={sequenceWith({ phase: "climb", text: "Airborne", detail: "Climbing to 3 m", trim: "learned", tilt_deg: 0 })}
      />,
    );
    expect(screen.getByTestId("launch-liftoff-text").textContent).toBe("Airborne. Climbing to 3 m");
  });

  it("shows the stop text in place of the error code once stopped", () => {
    render(
      <LaunchStepStrip
        sequence={sequenceWith(
          { phase: "stopped", text: "Take-off stopped", detail: "The drone started to tip. Motors off.", trim: "learned", tilt_deg: 6 },
          "liftoff_tipping",
        )}
      />,
    );
    expect(screen.getByTestId("launch-liftoff-text").textContent).toBe("Take-off stopped. The drone started to tip. Motors off.");
    expect(screen.queryByText(/liftoff_tipping/)).toBeNull();
  });

  it("drops the airborne line once the sequence carries an error", () => {
    render(
      <LaunchStepStrip
        sequence={sequenceWith({ phase: "climb", text: "Airborne", detail: "Climbing to 3 m", trim: "learned", tilt_deg: 0 }, "no_fc")}
      />,
    );
    expect(screen.queryByTestId("launch-liftoff-text")).toBeNull();
  });
});

describe("balance check readiness row", () => {
  const readiness = [
    { id: "airframe_balance", ok: false, severity: "warn" as const, msg: "Balance: nose-heavy. Off by about 35 mm. Move the battery back." },
    { id: "supervised_liftoff", ok: false, severity: "warn" as const, msg: "Standard take-off. Steady take-off is off." },
  ];

  it("labels the rows Balance check and Steady take-off", () => {
    expect(specString("readiness.item.airframe_balance")).toBe("Balance check");
    expect(specString("readiness.item.supervised_liftoff")).toBe("Steady take-off");
  });

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
          <StatusPillList listRef={{ current: null }} alerts={alerts} armed={false} />
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

  it("offers I rebalanced it only while the drone is known disarmed", () => {
    const alerts = pillAlerts({ alerts: [], readiness, prearm: undefined, storagePct: null, pilotAgeMs: 0 });
    for (const armed of [true, null] as const) {
      renderWithIntl(
        <FlightGridContext.Provider value={flightGrid({ width: 1280, height: 800, widthClass: "expanded" })}>
          <div className="ados-cockpit" data-testid="flight-screen">
            <StatusPillList listRef={{ current: null }} alerts={alerts} armed={armed} />
          </div>
        </FlightGridContext.Provider>,
      );
      expect(screen.getByText(readiness[0].msg)).toBeTruthy();
      expect(screen.queryByTestId("airframe-reset")).toBeNull();
      cleanup();
    }
  });

  it("shows a refused reset with the refusal text", async () => {
    setPilotSender(((f: { op: string; name: string; id: string }) => {
      if (f.op === "action") queueMicrotask(() => handlePilotServerFrame("d1", { kind: "action_result", name: f.name, id: f.id, ok: false, err: "armed" }));
      return true;
    }) as never, "d1");
    const alerts = pillAlerts({ alerts: [], readiness, prearm: undefined, storagePct: null, pilotAgeMs: 0 });
    renderWithIntl(
      <FlightGridContext.Provider value={flightGrid({ width: 1280, height: 800, widthClass: "expanded" })}>
        <div className="ados-cockpit" data-testid="flight-screen">
          <StatusPillList listRef={{ current: null }} alerts={alerts} armed={false} />
        </div>
      </FlightGridContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("airframe-reset"));
    expect((await screen.findByTestId("airframe-reset-refused")).textContent).toBe(refusalText("armed"));
  });
});
