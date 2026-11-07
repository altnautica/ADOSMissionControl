/**
 * @license GPL-3.0-only
 *
 * The flight-state chip's NOT READY state links to the aircraft setup wizard
 * when the pilot's readiness item `setup_needed` is red, and only then.
 */

import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import { FlightStateChip } from "../FlightStateChip";
import { parsePilotState } from "@/lib/cockpit/layers/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "chip-setup-test";

function pinReadiness(readiness: Array<{ id: string; ok: boolean; severity: "block" | "warn"; msg: string }>) {
  const pilot = parsePilotState(demoPilotWire({ readiness }));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot, Date.now());
}

function mount() {
  return render(
    <IntlWrapper>
      <FlightStateChip droneId={DRONE} />
    </IntlWrapper>,
  );
}

describe("FlightStateChip setup link", () => {
  afterEach(() => useNavStreamStore.getState().clear(DRONE));

  it("links NOT READY to the aircraft setup wizard when setup is needed", () => {
    pinReadiness([{ id: "setup_needed", ok: false, severity: "block", msg: "Aircraft setup needed" }]);
    mount();
    expect(screen.getByTestId("flight-state-chip").getAttribute("data-chip")).toBe("idle_not_ready");
    const link = screen.getByTestId("chip-setup-link");
    expect(link.getAttribute("href")).toBe("/config/aircraft-setup");
    expect(link.textContent).toBe("Set up aircraft");
  });

  it("shows no setup link when another item blocks readiness", () => {
    pinReadiness([{ id: "position", ok: false, severity: "block", msg: "No position estimate" }]);
    mount();
    expect(screen.getByTestId("flight-state-chip").getAttribute("data-chip")).toBe("idle_not_ready");
    expect(screen.queryByTestId("chip-setup-link")).toBeNull();
  });
});
