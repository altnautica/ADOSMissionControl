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

import { FlightFlowOverlays, countdownColor } from "../FlightFlowOverlays";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { specString } from "@/lib/cockpit/spec-strings";
import { useNavStreamStore } from "@/stores/nav-stream-store";

function mount(over: Record<string, unknown>) {
  const pilot = parsePilotState(demoPilotWire(over));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  // The overlays show only what a fresh pilot frame says.
  useNavStreamStore.getState().setPilot("countdown-test", pilot);
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
    expect(banner.getAttribute("data-severity")).toBe("critical");
  });

  it.each([
    ["low-battery-rth", "low_battery_rth", { rth_countdown_s: 9 }],
    ["link-loss-countdown", "link_loss", { link_loss_in_s: 4.2, link_loss_action: "rtl" }],
  ] as const)("%s words read at 4.5:1 or better on their fill", (testId, banner, over) => {
    mount(over);
    const el = screen.getByTestId(testId);
    expect(el.className).not.toMatch(/\btext-white\b/);
    expect(contrast(el.style.color, countdownColor(banner))).toBeGreaterThanOrEqual(4.5);
  });
});

function luminance(css: string): number {
  const rgb = css.startsWith("#")
    ? [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16))
    : (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  if (!fg) return 1;
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
