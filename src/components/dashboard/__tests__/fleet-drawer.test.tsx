/**
 * @module dashboard/fleet-drawer.test
 * @description Below md the dashboard's fleet sidebar is a drawer, closed by
 * default, so a node's detail gets a phone's full width (a fixed 288 px
 * sidebar left the Setup panel 0 px wide at 412). A toggle opens it over the
 * page, and picking a node closes it onto that node's detail. From md up the
 * sidebar stays in the row.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => null,
}));
vi.mock("@/hooks/use-fleet-nodes", () => ({ useFleetNodes: () => [{ _id: "node:a" }] }));
vi.mock("@/components/dashboard/DroneListPanel", () => ({
  DroneListPanel: (p: { collapsed: boolean; onPicked?: () => void }) => (
    <div data-testid="fleet-list" data-collapsed={String(p.collapsed)}>
      <button
        type="button"
        onClick={() => {
          useDroneManager.getState().selectDrone("node:a");
          p.onPicked?.();
        }}
      >
        pick-a
      </button>
    </div>
  ),
}));
vi.mock("@/components/dashboard/node-detail/NodeDetailPanel", () => ({
  NodeDetailPanel: (p: { fleetToggle?: ReactNode }) => <div data-testid="detail">{p.fleetToggle}</div>,
}));
vi.mock("@/components/dashboard/DashboardOverview", () => ({ DashboardOverview: () => null }));
vi.mock("@/components/command/CommandFleetOverview", () => ({ CommandFleetOverview: () => null }));
vi.mock("@/components/command/nodes-view/NodesView", () => ({ NodesView: () => null }));
vi.mock("@/components/command/swarm-view/SwarmView", () => ({ SwarmView: () => null }));
vi.mock("@/components/dashboard/EmptyFleetState", () => ({ EmptyFleetState: () => null }));

import messages from "../../../../locales/en.json";
import DashboardPage from "@/app/page";
import { useDroneManager } from "@/stores/drone-manager";
import { useUiStore } from "@/stores/ui-store";

const classes = (el: Element) => el.className.split(/\s+/);

beforeEach(() => {
  useDroneManager.setState({ selectedDroneId: null });
  useUiStore.setState({ immersiveMode: false });
});
afterEach(cleanup);

describe("Dashboard fleet drawer below md", () => {
  it("keeps the sidebar out of the narrow layout until opened, and in the row from md", () => {
    render(<DashboardPage />, { wrapper: IntlWrapper });
    const sidebar = screen.getByTestId("fleet-sidebar");
    expect(classes(sidebar)).toEqual(expect.arrayContaining(["hidden", "md:flex"]));

    const toggle = screen.getByRole("button", { name: messages.fleet.title });
    expect(classes(toggle)).toContain("md:hidden");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(classes(sidebar)).not.toContain("hidden");
    expect(classes(sidebar)).toEqual(expect.arrayContaining(["max-md:absolute", "max-md:z-40"]));
    // The drawer shows the full list, and a backdrop closes it.
    expect(screen.getByTestId("fleet-list").dataset.collapsed).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: messages.fleet.collapsePanel }));
    expect(classes(sidebar)).toContain("hidden");
  });

  it("closes onto the picked node's detail, which carries the toggle", () => {
    render(<DashboardPage />, { wrapper: IntlWrapper });
    fireEvent.click(screen.getByRole("button", { name: messages.fleet.title }));
    fireEvent.click(screen.getByText("pick-a"));

    expect(classes(screen.getByTestId("fleet-sidebar"))).toContain("hidden");
    const detail = screen.getByTestId("detail");
    expect(detail.querySelector('[data-testid="fleet-drawer-open"]')).not.toBeNull();
  });
});
