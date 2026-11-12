/**
 * @license GPL-3.0-only
 *
 * The flight-screen map card's corner buttons: the expand button puts the
 * cockpit on its Map view (it no longer leaves for another tab), and both
 * 24 px buttons carry a 48 px hit area.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("@/components/map/local/use-minimap-frame", () => ({
  useMinimapFrame: () => ({ frame: "global", pin: "auto", setPin: () => {} }),
}));

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { CockpitMinimap } from "../CockpitMinimap";
import { useCockpitViewStore } from "@/lib/cockpit/views";
import { useUiStore } from "@/stores/ui-store";
import messages from "../../../../locales/en.json";

const DRONE = "node:minimap-corner";

afterEach(() => {
  cleanup();
  useCockpitViewStore.setState({ byDrone: {}, splitByDrone: {} });
});

describe("cockpit minimap corner buttons", () => {
  it("switches this drone's cockpit to the Map view", () => {
    const pending = useUiStore.getState().pendingDetailTab;
    renderWithIntl(<CockpitMinimap droneId={DRONE} />);
    const open = screen.getByTestId("minimap-open-map");
    expect(open.getAttribute("title")).toBe(messages.cockpit.openMapView);
    fireEvent.click(open);
    expect(useCockpitViewStore.getState().byDrone[DRONE]).toBe("map");
    expect(useUiStore.getState().pendingDetailTab).toBe(pending);
  });

  it("gives both 24 px buttons a 48 px hit area", () => {
    renderWithIntl(<CockpitMinimap droneId={DRONE} />);
    for (const id of ["minimap-open-map", "minimap-layers"]) {
      expect(screen.getByTestId(id).classList.contains("mmap-hit")).toBe(true);
    }
    const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");
    const rule = css.match(/\.mmap \.mmap-hit::after \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("width: 48px");
    expect(rule).toContain("height: 48px");
  });
});
