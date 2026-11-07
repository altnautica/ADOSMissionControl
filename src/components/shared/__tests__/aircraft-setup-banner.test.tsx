/**
 * @license GPL-3.0-only
 *
 * The first-connect setup prompt: shown once per flight-controller uid whose
 * ground setup is not complete, never for a completed one or a drone with no
 * agent setup engine, and remembered across reloads once followed or skipped.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { SetupStatus, WizardState } from "@/lib/fc-setup/types";

const engine: { status: SetupStatus | null } = { status: null };

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/fc-setup/use-fc-setup", () => ({
  useAgentFcSetup: () => (engine.status ? { status: engine.status } : null),
}));

import { AircraftSetupBanner, SETUP_OFFERED_KEY } from "../AircraftSetupBanner";

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

describe("AircraftSetupBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    engine.status = null;
  });

  it("stays hidden for a direct-serial FC (no agent setup engine)", () => {
    render(<AircraftSetupBanner />);
    expect(screen.queryByTestId("aircraft-setup-banner")).toBeNull();
  });

  it("stays hidden once the ground setup is complete", () => {
    engine.status = statusFor("fc-1", "done");
    render(<AircraftSetupBanner />);
    expect(screen.queryByTestId("aircraft-setup-banner")).toBeNull();
  });

  it("offers setup for a new uid, links to the wizard, and offers it once", () => {
    engine.status = statusFor("fc-2", "not_started");
    const first = render(<AircraftSetupBanner />);
    const open = screen.getByTestId("aircraft-setup-banner-open");
    expect(open.getAttribute("href")).toBe("/config/aircraft-setup");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByTestId("aircraft-setup-banner")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(SETUP_OFFERED_KEY) ?? "[]")).toEqual(["fc-2"]);
    first.unmount();

    render(<AircraftSetupBanner />);
    expect(screen.queryByTestId("aircraft-setup-banner")).toBeNull();

    engine.status = statusFor("fc-3", "not_started");
    render(<AircraftSetupBanner />);
    expect(screen.getByTestId("aircraft-setup-banner")).toBeTruthy();
  });
});
