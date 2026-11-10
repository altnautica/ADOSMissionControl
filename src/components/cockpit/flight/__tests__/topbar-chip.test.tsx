/**
 * @license GPL-3.0-only
 *
 * The flight-state chip takes at most 40 % of the top bar and ends a longer
 * text in an ellipsis, with the full text in its title and accessible name
 * (`chip.aria`). At the compact classes it shows its compact face (the state
 * text alone). Its action button reads the spec's words.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { specString } from "@/lib/cockpit/spec-strings";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { CHIP_MAX_FRAC, FlightStateChip } from "../../v2/FlightStateChip";

const DRONE = "topbar-chip";

function pin(over: Record<string, unknown> = {}) {
  const pilot = parsePilotState(demoPilotWire(over));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot, Date.now());
}

afterEach(() => {
  cleanup();
  useNavStreamStore.getState().clear(DRONE);
});

describe("flight-state chip in the top bar", () => {
  it("is capped at 40 % of the bar with an ellipsis and the full text in title and aria", () => {
    pin();
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    expect(CHIP_MAX_FRAC).toBe(0.4);
    const wrap = screen.getByTestId("flight-state-chip");
    expect(wrap.getAttribute("data-max-frac")).toBe("0.4");
    expect(wrap.style.maxWidth).toBe("400px");
    expect(wrap.style.minWidth).toMatch(/^0(px)?$/);

    const text = screen.getByTestId("flight-state-chip-text");
    expect(text.style.textOverflow).toBe("ellipsis");
    expect(text.style.whiteSpace).toBe("nowrap");
    expect(text.style.overflow).toBe("hidden");

    const button = wrap.querySelector("button")!;
    const title = button.getAttribute("title")!;
    expect(title.startsWith(text.textContent!)).toBe(true);
    expect(title).toContain("ADOS PILOT");
    expect(button.getAttribute("aria-label")).toBe(specString("chip.aria", { text: title }));
  });

  it("shows the compact face only at the compact classes, keeping the full text in its title", () => {
    pin();
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={560} compact />);
    const wrap = screen.getByTestId("flight-state-chip");
    expect(wrap.getAttribute("data-face")).toBe("compact");
    expect(wrap.style.maxWidth).toBe("224px");
    expect(wrap.querySelector(".fs-chip-sub")).toBeNull();
    expect(wrap.querySelector("button")!.getAttribute("title")).toContain("ADOS PILOT");
  });

  it("shows the secondary line on the full face", () => {
    pin();
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    expect(screen.getByTestId("flight-state-chip").querySelector(".fs-chip-sub")?.textContent).toContain("ADOS PILOT");
  });

  it("labels its take-control button from the spec", () => {
    pin({ owner: "fc_mode", control_mode: "fc_manual" });
    renderWithIntl(<FlightStateChip droneId={DRONE} barWidth={1000} />);
    const action = screen.getByTestId("flight-state-chip").querySelector(".fs-chip-action")!;
    expect(action.textContent).toBe(specString("flow.take_control"));
  });
});
