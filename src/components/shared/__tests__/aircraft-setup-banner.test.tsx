/**
 * @license GPL-3.0-only
 *
 * The aircraft setup offer: shown once per flight-controller uid whose ground
 * setup is not done, never for a completed one or a drone with no agent setup
 * engine, remembered per device once opened or put off, and only on the
 * ground (no flight screen mounted, nothing armed).
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { SetupStatus, WizardState } from "@/lib/fc-setup/types";

const engine: { status: SetupStatus | null } = { status: null };

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/fc-setup/use-fc-setup", () => ({
  useAgentFcSetup: () => (engine.status ? { status: engine.status } : null),
}));

import { AircraftSetupBanner } from "../AircraftSetupBanner";
import { SETUP_OFFERED_KEY, useAircraftSetupOfferStore } from "@/stores/aircraft-setup-offer-store";
import { useFlightScreenStore } from "@/stores/flight-screen-store";
import { useNodeRegistryStore } from "@/stores/node-registry/node-registry-store";

function statusFor(uid: string, ground: WizardState): SetupStatus {
  return {
    uid,
    firmware: "ArduCopter",
    firmware_version: "4.5.7",
    vehicle_class: "multirotor",
    running: null,
    wizards: [{ id: "ground", state: ground, available: true, blockers: [], completed_at: null, steps: [] }],
    report: null,
  };
}

function setArmed(armed: boolean) {
  useNodeRegistryStore.setState({
    nodes: { d1: { fc: { armState: armed ? "armed" : "disarmed" } } } as never,
  });
}

const banner = () => screen.queryByTestId("aircraft-setup-banner");

/** The offered uids as persisted on this device (zustand persist envelope). */
function storedUids(): unknown {
  const raw = window.localStorage.getItem(SETUP_OFFERED_KEY);
  return raw ? JSON.parse(raw).state.offered : [];
}

describe("AircraftSetupBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAircraftSetupOfferStore.setState({ offered: [] });
    useFlightScreenStore.setState({ mounted: 0 });
    setArmed(false);
    engine.status = null;
  });
  afterEach(() => {
    useNodeRegistryStore.setState({ nodes: {} });
  });

  it("stays hidden for a direct-serial FC (no agent setup engine)", () => {
    render(<AircraftSetupBanner />);
    expect(banner()).toBeNull();
  });

  it("stays hidden once the ground setup is complete", () => {
    engine.status = statusFor("fc-1", "done");
    render(<AircraftSetupBanner />);
    expect(banner()).toBeNull();
  });

  it("offers a new uid with Open to the wizard and Later, once per uid", () => {
    engine.status = statusFor("fc-2", "not_started");
    const first = render(<AircraftSetupBanner />);
    expect(banner()?.textContent).toContain("Set up this aircraft");
    expect(screen.getByTestId("aircraft-setup-banner-open").textContent).toBe("Open");
    expect(screen.getByTestId("aircraft-setup-banner-later").textContent).toBe("Later");
    expect(screen.getByTestId("aircraft-setup-banner-open").getAttribute("href")).toBe("/config/aircraft-setup");
    fireEvent.click(screen.getByTestId("aircraft-setup-banner-later"));
    expect(banner()).toBeNull();
    expect(storedUids()).toEqual(["fc-2"]);
    first.unmount();

    render(<AircraftSetupBanner />);
    expect(banner()).toBeNull();

    engine.status = statusFor("fc-3", "not_started");
    render(<AircraftSetupBanner />);
    expect(banner()).not.toBeNull();
  });

  it("records the uid when Open is followed", () => {
    engine.status = statusFor("fc-4", "running");
    render(<AircraftSetupBanner />);
    fireEvent.click(screen.getByTestId("aircraft-setup-banner-open"));
    expect(banner()).toBeNull();
    expect(storedUids()).toEqual(["fc-4"]);
  });

  it("never shows while a flight screen is mounted, and keeps the offer for the ground", () => {
    engine.status = statusFor("fc-5", "not_started");
    useFlightScreenStore.setState({ mounted: 1 });
    render(<AircraftSetupBanner />);
    expect(banner()).toBeNull();
    act(() => useFlightScreenStore.setState({ mounted: 0 }));
    expect(banner()).not.toBeNull();
    expect(storedUids()).toEqual([]);
  });

  it("never shows while a vehicle is armed", () => {
    engine.status = statusFor("fc-6", "not_started");
    setArmed(true);
    render(<AircraftSetupBanner />);
    expect(banner()).toBeNull();
    act(() => setArmed(false));
    expect(banner()).not.toBeNull();
  });
});
