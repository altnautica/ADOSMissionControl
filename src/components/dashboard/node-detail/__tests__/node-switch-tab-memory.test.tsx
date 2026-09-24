/**
 * @module node-detail/node-switch-tab-memory.test
 * @description The panel is deliberately NOT remounted per node (no `key` at
 * the call site: the Agent page's sub-page memory depends on the instance
 * surviving), so "return where you left off"
 * lives entirely in this shell's seed / persist logic.
 *
 * It used to be dead for anyone who switched nodes, which is the normal fleet
 * workflow: the seed ran once per mount so node B never got its own tab, and
 * the persist effect then fired on the droneId change with node A's tab still
 * in state — writing `cockpit` into a workstation's record, a tab that profile
 * does not have. Every subsequent open of that node landed on the fallback.
 *
 * These pin the three halves: reseed on switch, never persist an id the node
 * could not resolve, and fall back visibly without destroying the memory.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

vi.hoisted(() => {
  // The persisted ui-prefs store captures its storage at import, and
  // happy-dom's localStorage.setItem is not a function here.
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
vi.mock("@/hooks/use-plugin-contributions", () => ({
  usePluginContributions: () => [],
}));
vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginContributions: () => [],
  useLiveInstallRows: () => null,
}));
vi.mock("@/hooks/use-fleet-nodes", () => ({ useFleetNodes: () => [] }));
vi.mock("@/hooks/use-forget-node", () => ({ useForgetNode: () => vi.fn() }));
vi.mock("@/hooks/use-node-control-authority", () => ({
  useNodeControlAuthorityNotice: () => ({ show: false }),
}));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isDemoMode: () => true,
}));

// The real per-profile id sets, with trivial bodies: the subject is the
// shell's memory, not what a surface renders.
vi.mock("../surfaces", () => ({
  resolveSurfaces: (ctx: { drone: { profile?: string } }) => {
    const ids =
      ctx.drone.profile === "workstation"
        ? ["overview", "logs", "agent"]
        : ctx.drone.profile === "ground-station"
          ? ["overview", "cockpit", "radio", "mesh", "logs", "agent"]
          : ["overview", "flight", "cockpit", "configure", "logs", "agent"];
    return ids.map((id) => ({
      id,
      labelKey: id,
      render: () => <div>{`body-${id}`}</div>,
    }));
  },
}));

import { NodeDetailPanel } from "../NodeDetailPanel";
import { useFleetStore } from "@/stores/fleet-store";
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import type { FleetDrone } from "@/lib/types";

function node(id: string, profile: string): FleetDrone {
  return { id, name: id, status: "online", profile } as unknown as FleetDrone;
}

const DRONE = "node:drone-1";
const GS = "node:gs-1";
const WS = "node:ws-1";

beforeEach(() => {
  cleanup();
  useFleetStore.setState({
    drones: [node(DRONE, "drone"), node(GS, "ground-station"), node(WS, "workstation")],
  });
  useUiPrefsStore.setState({ lastTabByNode: {}, lastAgentPanelByNode: {} });
});

const selected = (c: HTMLElement) =>
  c.querySelector('[role="tab"][aria-selected="true"]')?.id?.replace("drone-tab-", "");

describe("node-detail tab memory across a node switch", () => {
  it("returns each node to its own remembered tab", () => {
    useUiPrefsStore.setState({
      lastTabByNode: { [DRONE]: "cockpit", [GS]: "mesh", [WS]: "logs" },
    });
    const { container, rerender } = render(
      <NodeDetailPanel droneId={DRONE} onClose={() => {}} />,
    );
    expect(selected(container)).toBe("cockpit");

    rerender(<NodeDetailPanel droneId={GS} onClose={() => {}} />);
    expect(selected(container)).toBe("mesh");

    rerender(<NodeDetailPanel droneId={WS} onClose={() => {}} />);
    expect(selected(container)).toBe("logs");

    // ...and back, unchanged.
    rerender(<NodeDetailPanel droneId={DRONE} onClose={() => {}} />);
    expect(selected(container)).toBe("cockpit");
  });

  it("never writes a tab the target node cannot resolve into its record", () => {
    useUiPrefsStore.setState({ lastTabByNode: { [DRONE]: "cockpit" } });
    const { rerender } = render(
      <NodeDetailPanel droneId={DRONE} onClose={() => {}} />,
    );
    rerender(<NodeDetailPanel droneId={WS} onClose={() => {}} />);

    // The workstation profile has no cockpit; its record must not acquire one.
    expect(useUiPrefsStore.getState().lastTabByNode[WS]).not.toBe("cockpit");
    // ...and the drone's own memory survives the trip.
    expect(useUiPrefsStore.getState().lastTabByNode[DRONE]).toBe("cockpit");
  });

  it("resolves a retired tab id to the surface that absorbed it", () => {
    // A drone remembered on the retired Flights tab.
    useUiPrefsStore.setState({ lastTabByNode: { [DRONE]: "flights" } });
    const { container } = render(
      <NodeDetailPanel droneId={DRONE} onClose={() => {}} />,
    );
    // `flights` merged into `logs`, so the alias resolves it rather than
    // dropping the operator on the first surface.
    expect(selected(container)).toBe("logs");
  });

  it("falls back from a plugin tab whose plugin is gone, without persisting the dead id", () => {
    useUiPrefsStore.setState({ lastTabByNode: { [DRONE]: "plugin:removed-install" } });
    const { container } = render(<NodeDetailPanel droneId={DRONE} onClose={() => {}} />);
    // No contribution carries that id: the first surface shows instead of an
    // empty plugin body.
    expect(selected(container)).toBe("overview");
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toBe("body-overview");
    expect(useUiPrefsStore.getState().lastTabByNode[DRONE]).toBe("plugin:removed-install");
  });

  it("persists a tab the operator actually reaches", () => {
    const { container } = render(
      <NodeDetailPanel droneId={GS} onClose={() => {}} />,
    );
    fireEvent.click(container.querySelector("#drone-tab-mesh")!);
    expect(useUiPrefsStore.getState().lastTabByNode[GS]).toBe("mesh");
  });
});
