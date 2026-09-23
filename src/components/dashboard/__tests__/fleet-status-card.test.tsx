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
import { useFleetStore } from "@/stores/fleet-store";
import type { FleetDrone } from "@/lib/types";

function row(id: string, status: string, navigationGpsDenied: boolean): FleetDrone {
  return { id, name: id, status, navigationGpsDenied } as unknown as FleetDrone;
}

afterEach(() => {
  cleanup();
  useFleetStore.setState({ drones: [] });
});

describe("FleetStatusCard GPS-denied count", () => {
  it("counts only nodes that are not offline", () => {
    useFleetStore.setState({
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
    useFleetStore.setState({ drones: [row("b", "offline", true)] });
    render(<FleetStatusCard />);
    expect(screen.queryByText("GPS-denied")).toBeNull();
  });
});
