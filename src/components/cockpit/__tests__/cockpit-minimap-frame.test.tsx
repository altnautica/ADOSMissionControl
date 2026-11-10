/**
 * @license GPL-3.0-only
 *
 * The cockpit minimap's frame toggle: AUTO | LOCAL | MAP, persisted per
 * vehicle, swaps the tile overview for the local-frame map.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { specString } from "@/lib/cockpit/spec-strings";
import messages from "../../../../locales/en.json";

vi.mock("next/dynamic", () => ({
  default: () => function OverviewMapStub() {
    return <div data-testid="overview-map" />;
  },
}));

import { CockpitMinimap } from "@/components/cockpit/CockpitMinimap";
import { useMinimapModeStore } from "@/stores/minimap-mode-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const DRONE = "node:minimap-test";

function renderMinimap() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitMinimap droneId={DRONE} />
    </NextIntlClientProvider>,
  );
}

describe("CockpitMinimap frame", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    useMinimapModeStore.setState({ pinByVehicle: {} });
  });
  afterEach(() => cleanup());

  it("shows the tile overview in AUTO with a 3D fix and no local source", () => {
    useTelemetryStore.getState().gps.push({ timestamp: Date.now(), fixType: 3, satellites: 12, lat: 0, lon: 0, alt: 0 });
    const { container } = renderMinimap();
    expect(container.querySelector(".mmap")?.getAttribute("data-frame")).toBe("global");
    expect(screen.getAllByTestId("overview-map").length).toBeGreaterThan(0);
  });

  it("pins LOCAL per vehicle and draws the local frame", () => {
    const { container } = renderMinimap();
    fireEvent.click(screen.getByRole("button", { name: specString("minimap.pin.local") }));
    expect(useMinimapModeStore.getState().pinByVehicle[DRONE]).toBe("local");
    expect(container.querySelector(".mmap")?.getAttribute("data-frame")).toBe("local");
    expect(container.querySelector(".lfmap")).not.toBeNull();
    expect(container.textContent).toContain(specString("minimap.local_ne"));

    fireEvent.click(screen.getByRole("button", { name: specString("minimap.pin.auto") }));
    expect(useMinimapModeStore.getState().pinByVehicle[DRONE]).toBeUndefined();
  });
});
