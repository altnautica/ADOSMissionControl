/**
 * @license GPL-3.0-only
 *
 * The flight-flow countdowns: the link-loss countdown names the action the
 * drone is configured to take, and the low-battery return shows its cancel
 * warning inline (not only in a tooltip); both use the critical colour.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import { FlightFlowOverlays } from "../FlightFlowOverlays";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { specString } from "@/lib/cockpit/spec-strings";

function mount(over: Record<string, unknown>) {
  const pilot = parsePilotState(demoPilotWire(over));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  return render(
    <IntlWrapper>
      <FlightFlowOverlays droneId="countdown-test" pilot={pilot} />
    </IntlWrapper>,
  );
}

describe("flight-flow countdowns", () => {
  it.each([
    ["land", "Land"],
    ["rtl", "Return home"],
    ["loiter", "Hold"],
  ])("link-loss countdown with action %s says %s", (action, words) => {
    mount({ link_loss_in_s: 4.2, link_loss_action: action });
    const banner = screen.getByTestId("link-loss-countdown");
    expect(banner.textContent).toContain(words);
    expect(banner.textContent).toContain("5");
    expect(banner.textContent).not.toContain("failsafe");
  });

  it("low-battery return shows its cancel warning inline, in the critical colour", () => {
    mount({ rth_countdown_s: 9 });
    const banner = screen.getByTestId("low-battery-rth");
    expect(screen.getByTestId("low-battery-cancel-warning").textContent).toBe(
      specString("flow.low_battery.cancel_warning"),
    );
    expect(banner.className).toContain("bg-status-error");
  });
});
