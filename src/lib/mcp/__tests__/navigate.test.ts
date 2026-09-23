import { afterEach, describe, expect, it } from "vitest";
import { canNavigateToRow, navigateToRow } from "../navigate";
import type { McpActivityRow, McpSurface } from "../activity";
import { useFleetStore } from "@/stores/fleet-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { FleetDrone } from "@/lib/types";

function row(node: string, surface: McpSurface): McpActivityRow {
  return {
    id: "r1",
    tsUs: 0,
    tool: "params.set",
    summary: "Set X",
    category: "config",
    node,
    decision: "allowed",
    lifecycle: "success",
    result: "",
    latencyMs: 1,
    args: {},
    plane: "lan_direct",
    surface,
  };
}

const TAB: McpSurface = { kind: "tab", id: "parameters" };

function seedFleet(deviceId: string) {
  useFleetStore.setState({
    drones: [{ id: `node:${deviceId}`, name: "Rig" } as unknown as FleetDrone],
  });
}

afterEach(() => {
  useFleetStore.setState({ drones: [] });
  useAgentConnectionStore.setState({ nodeDeviceId: null });
});

describe("MCP jump-to gating", () => {
  it("disables a tab jump whose node is not in this fleet", () => {
    seedFleet("dev-1");
    expect(canNavigateToRow(row("dev-2", TAB))).toBe(false);
    expect(canNavigateToRow(row("*", TAB))).toBe(false);
    expect(navigateToRow(row("dev-2", TAB))).toBeNull();
  });

  it("enables a tab jump whose node resolves", () => {
    seedFleet("dev-1");
    expect(canNavigateToRow(row("dev-1", TAB))).toBe(true);
  });

  it("resolves the agent-mode `local` node to the connected agent's row", () => {
    seedFleet("dev-1");
    expect(canNavigateToRow(row("local", TAB))).toBe(false);
    useAgentConnectionStore.setState({ nodeDeviceId: "dev-1" });
    expect(canNavigateToRow(row("local", TAB))).toBe(true);
  });

  it("always enables a whole-page route and never a feed-only row", () => {
    expect(canNavigateToRow(row("*", { kind: "route", path: "/plan" }))).toBe(true);
    expect(canNavigateToRow(row("dev-1", null))).toBe(false);
  });
});
