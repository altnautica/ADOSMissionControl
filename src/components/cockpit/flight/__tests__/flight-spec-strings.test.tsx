/**
 * @license GPL-3.0-only
 *
 * Flight-screen words that now have a shared spec key read it: the follow
 * range control (`follow.range`), the minimap frame toggle
 * (`minimap.pin.*`) and the link's reduced update rate
 * (`nav.reduced_rate`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicStub() {
      return null;
    },
}));

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { specString } from "@/lib/cockpit/spec-strings";
import { useMinimapModeStore } from "@/stores/minimap-mode-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";
import { FollowDock } from "../FollowDock";
import { LinkCell } from "../TopBarCells";
import { CockpitMinimap } from "../../CockpitMinimap";

const DRONE = "spec-strings";

afterEach(() => {
  cleanup();
  useNavStreamStore.setState({ byDrone: {} });
});

describe("flight-screen spec strings", () => {
  it("names the follow range control and its sheet with follow.range", () => {
    const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded", following: true });
    renderWithIntl(
      <FlightGridContext.Provider value={grid}>
        <FollowDock droneId={DRONE} />
      </FlightGridContext.Provider>,
    );
    const trigger = document.querySelector("[data-follow-range-trigger]") as HTMLElement;
    expect(trigger.getAttribute("aria-label")).toBe(specString("follow.range"));
  });

  it("labels the minimap frame toggle with minimap.pin.*", () => {
    useMinimapModeStore.setState({ pinByVehicle: { [DRONE]: "local" } });
    renderWithIntl(<CockpitMinimap droneId={DRONE} />);
    const group = screen.getAllByRole("group")[0];
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(
      ["auto", "local", "map"].map((p) => specString(`minimap.pin.${p}`)),
    );
  });

  it("names a polled link's reduced update rate with nav.reduced_rate", () => {
    useNavStreamStore.setState({ byDrone: { [DRONE]: { transport: "poll" } } } as never);
    renderWithIntl(<LinkCell droneId={DRONE} detail />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe(specString("nav.reduced_rate"));
  });
});
