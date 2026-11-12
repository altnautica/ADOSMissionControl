/**
 * @module dashboard/relayed-bridge-name.test
 * @description A drone the GCS already knows by name ("Alpha-01") and that is
 * also a relayed peer of a ground station without a name for it keeps its
 * name. The relayed patch used to write an "Agent <id>" placeholder over it,
 * so the planner's upload target and the fleet disagreed.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/agent/relayed-peers", () => ({
  planRelayedEnrollment: () => [
    {
      nodeId: "node:alpha-1",
      deviceId: "alpha-1",
      reachedVia: "node:gs-1",
      lastHeartbeat: Date.now(),
      peerRssiDbm: null,
      funneledStatus: undefined,
      realName: undefined,
      realProfile: undefined,
      agentIdentityKnown: false,
    },
  ],
}));
vi.mock("@/lib/agent/relayed-status-client", () => ({
  fetchRelayedStatus: async () => new Map(),
}));
vi.mock("@/lib/agent/fleet-slots-client", () => ({
  fetchFleetSlots: async () => null,
}));

import { RelayedDroneBridge } from "../RelayedDroneBridge";
import { useNodeRegistryStore } from "@/stores/node-registry";

afterEach(() => {
  cleanup();
  useNodeRegistryStore.setState({ nodes: {} } as never);
});

describe("RelayedDroneBridge presence name", () => {
  it("keeps a known name when the relay has none", () => {
    useNodeRegistryStore
      .getState()
      .upsertPresence(
        "node:alpha-1",
        { deviceId: "alpha-1", name: "Alpha-01", profile: "drone", lastHeartbeat: Date.now() },
        "local",
      );
    render(<RelayedDroneBridge />);
    const entry = useNodeRegistryStore.getState().nodes["node:alpha-1"];
    expect(entry?.presence.sources).toContain("relayed");
    expect(entry?.presence.name).toBe("Alpha-01");
  });
});
