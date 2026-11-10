/**
 * @license GPL-3.0-only
 *
 * STOP is always enabled and always opens the emergency stop's 3 s
 * hold-to-confirm (`holds_ms.stop`), also while the vehicle is disarmed; its
 * accessible name is the spec's `stop.hold_label`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { specString } from "@/lib/cockpit/spec-strings";
import { registerBuiltins } from "@/lib/skills";
import { useDroneStore } from "@/stores/drone-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { FlightTopBar } from "../FlightTopBar";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";

const DRONE = "topbar-stop";

function mount() {
  const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
  return renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <div className="ados-cockpit">
        <FlightTopBar droneId={DRONE} />
      </div>
    </FlightGridContext.Provider>,
  );
}

beforeEach(() => {
  registerBuiltins();
  useSkillConfirmStore.setState({ pending: null });
});

afterEach(() => {
  useSkillConfirmStore.getState().resolvePending(false);
  cleanup();
});

describe("top bar STOP", () => {
  it("is enabled while disarmed and labelled with the spec's hold label", () => {
    useDroneStore.setState({ armState: "disarmed" });
    mount();
    const stop = screen.getByTestId("cockpit-kill") as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    expect(stop.getAttribute("aria-label")).toBe(specString("stop.hold_label"));
    expect(stop.getAttribute("data-hold-ms")).toBe(String(layoutSpec.holds_ms.stop));
  });

  it("opens the 3 s hold-to-confirm while disarmed", async () => {
    useDroneStore.setState({ armState: "disarmed" });
    mount();
    fireEvent.click(screen.getByTestId("cockpit-kill"));
    await waitFor(() => expect(useSkillConfirmStore.getState().pending).not.toBeNull());
    const { policy } = useSkillConfirmStore.getState().pending!;
    expect(policy.gesture).toBe("guarded");
    expect(policy.holdMs).toBe(layoutSpec.holds_ms.stop);
    expect(policy.holdMs).toBe(3000);
    expect(policy.values?.drone).toBe(DRONE);
  });

  it("opens the same hold-to-confirm while armed", async () => {
    useDroneStore.setState({ armState: "armed" });
    mount();
    fireEvent.click(screen.getByTestId("cockpit-kill"));
    await waitFor(() => expect(useSkillConfirmStore.getState().pending).not.toBeNull());
    expect(useSkillConfirmStore.getState().pending!.policy.holdMs).toBe(3000);
  });
});
