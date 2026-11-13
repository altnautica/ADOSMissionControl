/**
 * @module node-detail/node-header-tab-row.test
 * @description The node-detail tabs own a full-width header row. Sharing a
 * row with the node name, chips, ID, Delete, badges and Reboot left the strip
 * a sliver at laptop widths: one of twelve tabs, or none when a node carried
 * more badges. The identity row wraps instead, and the dashboard's fleet
 * drawer toggle leads it.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

vi.hoisted(() => {
  // The persisted ui-prefs store captures its storage at import.
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
});

vi.mock("next-intl", () => ({
  useTranslations: () => Object.assign((k: string) => k, { rich: (k: string) => k }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/plugins/PluginHostProvider", () => ({
  PluginHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/plugins/DroneDetailTabHost", () => ({
  DroneDetailTabHeaders: () => null,
  DroneDetailTabBody: () => null,
  isPluginTabId: (id: string) => id.startsWith("plugin:"),
  pluginTabIds: () => [],
}));
vi.mock("@/hooks/use-plugin-contributions", () => ({ usePluginContributions: () => [] }));
vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginContributions: () => [],
  useLiveInstallRows: () => null,
}));
vi.mock("@/hooks/use-fleet-nodes", () => ({ useFleetNodes: () => [] }));
vi.mock("@/hooks/use-forget-node", () => ({ useForgetNode: () => vi.fn() }));
vi.mock("@/hooks/use-node-control-authority", () => ({
  useNodeControlAuthorityNotice: () => ({ show: false }),
}));
vi.mock("../surfaces", () => ({
  resolveSurfaces: () =>
    ["overview", "flight", "map", "sessions", "configure", "params", "logs", "agent"].map((id) => ({
      id,
      labelKey: id,
      render: () => <div>{`body-${id}`}</div>,
    })),
}));
// vi.mock factories are hoisted above the imports, so the fixture loads here.
vi.mock("@/stores/node-registry/use-fleet-drones", async (importOriginal) =>
  (await import("../../../../../tests/helpers/fleet-drones")).fleetDronesModuleMock(await importOriginal()),
);

import { NodeDetailPanel } from "../NodeDetailPanel";
import { setFixtureFleet } from "../../../../../tests/helpers/fleet-drones";
import type { FleetDrone } from "@/lib/types";

const DRONE = "node:alpha-1";

beforeEach(() => {
  cleanup();
  setFixtureFleet({
    drones: [{ id: DRONE, name: "Alpha-01", status: "online", profile: "drone" } as unknown as FleetDrone],
  });
});

describe("node-detail header", () => {
  it("gives the tab strip a row of its own, clear of the identity and actions", () => {
    render(<NodeDetailPanel droneId={DRONE} onClose={() => {}} />);
    const strip = screen.getByRole("tablist");
    // strip -> its scroll wrapper -> the row that holds it.
    const row = strip.parentElement!.parentElement!;
    expect(row.children).toHaveLength(1);
    expect(row.querySelector("h1")).toBeNull();
    expect(row.textContent).not.toContain(`ID: ${DRONE}`);
    expect(row.textContent).not.toContain("delete");
    expect(screen.getAllByRole("tab")).toHaveLength(8);

    const heading = screen.getByRole("heading", { name: "Alpha-01" });
    expect(heading.parentElement!.className.split(/\s+/)).toContain("flex-wrap");
    expect(heading.parentElement!.textContent).toContain(`ID: ${DRONE}`);
  });

  it("leads the identity row with the fleet toggle it is given", () => {
    render(
      <NodeDetailPanel
        droneId={DRONE}
        onClose={() => {}}
        fleetToggle={<button type="button">fleet-toggle</button>}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Alpha-01" });
    expect(heading.parentElement!.firstElementChild?.textContent).toBe("fleet-toggle");
  });
});
