/**
 * @module dashboard/fleet-status-card.test
 * @description The GPS-denied count is a claim about the fleet now, so an
 * offline node's last-reported navigation flag must not be counted.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { FleetStatusCard } from "../FleetStatusCard";
import { setFixtureFleet } from "../../../../tests/helpers/fleet-drones";

vi.mock("@/stores/node-registry/use-fleet-drones", async (importOriginal) =>
  (await import("../../../../tests/helpers/fleet-drones")).fleetDronesModuleMock(await importOriginal()),
);
import type { FleetDrone } from "@/lib/types";

function row(id: string, status: string, navigationGpsDenied: boolean): FleetDrone {
  return { id, name: id, status, navigationGpsDenied } as unknown as FleetDrone;
}

afterEach(() => {
  cleanup();
  setFixtureFleet({ drones: [] });
});

describe("FleetStatusCard GPS-denied count", () => {
  it("counts only nodes that are not offline", () => {
    setFixtureFleet({
      drones: [
        row("a", "online", true),
        row("b", "offline", true),
        row("c", "offline", true),
      ],
    });
    render(<FleetStatusCard />);
    const label = screen.getByText("GPS-denied");
    expect(label.parentElement?.nextElementSibling?.textContent).toBe("1");
  });

  it("hides the row when every GPS-denied node is offline", () => {
    setFixtureFleet({ drones: [row("b", "offline", true)] });
    render(<FleetStatusCard />);
    expect(screen.queryByText("GPS-denied")).toBeNull();
  });
});
