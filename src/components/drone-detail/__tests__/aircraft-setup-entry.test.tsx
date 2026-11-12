/**
 * @license GPL-3.0-only
 *
 * Aircraft setup names the drone it acts on: Settings › Aircraft setup has a
 * picker of fleet drones with an agent and a "Setting up {name}" heading, and
 * the drone's own Setup nav opens the same wizards first.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";

const dm = { selectedDroneId: null as string | null, selectDrone: vi.fn() };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel(dm),
}));
vi.mock("@/stores/node-registry/use-fleet-drones", () => ({
  fleetFieldsEqual: () => () => true,
  selectFleet: (d: unknown) => d,
  useFleetDrones: (sel: (drones: unknown[]) => unknown) =>
    sel([
      { id: "d-agent", name: "Hangar Quad", cloudDeviceId: "dev-1", reachedVia: null },
      { id: "d-bare", name: "Bare FC", cloudDeviceId: null, reachedVia: null },
    ]),
}));
const nav = { drone: null as string | null, replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.drone ? { drone: nav.drone } : {}),
}));
vi.mock("@/lib/nodes/relay-reach", () => ({ resolveRelayReach: () => null }));
vi.mock("@/lib/fc-setup/use-fc-setup", () => ({
  useDroneSetupTransport: () => null,
  useFcSetup: () => null,
}));
vi.mock("@/components/aircraft-setup/AircraftSetupView", () => ({ AircraftSetupView: () => null }));

import AircraftSetupPage from "@/app/config/aircraft-setup/page";
import { FC_NAV_ITEMS } from "@/components/drone-detail/fc-nav-items";

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AircraftSetupPage />
    </NextIntlClientProvider>,
  );
}

describe("Aircraft setup names its drone", () => {
  beforeEach(() => {
    dm.selectedDroneId = null;
    dm.selectDrone.mockReset();
    nav.drone = null;
    nav.replace.mockReset();
  });

  it("selects the drone named in the URL and writes the pick back to it", () => {
    nav.drone = "d-agent";
    renderPage();
    expect(dm.selectDrone).toHaveBeenCalledWith("d-agent");
    nav.drone = null;
    dm.selectDrone.mockReset();
    renderPage();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "d-agent" } });
    expect(nav.replace).toHaveBeenCalledWith("/config/aircraft-setup?drone=d-agent");
  });

  it("offers only fleet drones with an agent and selects the one picked", () => {
    renderPage();
    const picker = screen.getByRole("combobox", { name: messages.aircraftSetup.pickDrone });
    const names = Array.from((picker as HTMLSelectElement).options).map((o) => o.textContent);
    expect(names).toContain("Hangar Quad");
    expect(names).not.toContain("Bare FC");
    fireEvent.change(picker, { target: { value: "d-agent" } });
    expect(dm.selectDrone).toHaveBeenCalledWith("d-agent");
  });

  it("heads the wizards with the drone being set up", () => {
    dm.selectedDroneId = "d-agent";
    renderPage();
    expect(
      screen.getByRole("heading", { name: messages.aircraftSetup.settingUp.replace("{name}", "Hangar Quad") }),
    ).toBeTruthy();
  });

  it("puts Aircraft setup first in the drone's Setup nav, reachable without the FC link", () => {
    const first = FC_NAV_ITEMS[0];
    expect(first.id).toBe("aircraft-setup");
    expect(first.agentSide).toBe(true);
  });
});
