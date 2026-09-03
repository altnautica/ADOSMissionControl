import { describe, it, expect, vi, afterEach } from "vitest";
import { pairedAgentDeviceIdForUrl } from "@/lib/agent/paired-agent-match";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";

function node(overrides: Partial<LocalNode>): LocalNode {
  return {
    deviceId: "dev-1",
    name: "ados-x",
    hostname: "http://ados-x.local:8080",
    apiKey: "k",
    profile: "drone",
    pairedAt: 1,
    ...overrides,
  };
}

// Stub the store's getState so the matcher sees a fixed node list without
// touching the persist (localStorage) middleware.
function withNodes(nodes: LocalNode[]) {
  vi.spyOn(useLocalNodesStore, "getState").mockReturnValue({
    nodes,
  } as unknown as ReturnType<typeof useLocalNodesStore.getState>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pairedAgentDeviceIdForUrl", () => {
  it("matches an FC WebSocket against the node's .local hostname", () => {
    withNodes([node({})]);
    expect(pairedAgentDeviceIdForUrl("ws://ados-x.local:8765/")).toBe("dev-1");
  });

  it("matches against the node's mDNS host", () => {
    withNodes([
      node({ hostname: "http://10.0.0.5:8080", mdnsHost: "ados-abc.local" }),
    ]);
    expect(pairedAgentDeviceIdForUrl("ws://ados-abc.local:8765/")).toBe("dev-1");
  });

  it("matches against the node's captured IPv4", () => {
    withNodes([node({ ipv4: "192.168.1.51" })]);
    expect(pairedAgentDeviceIdForUrl("ws://192.168.1.51:8765/")).toBe("dev-1");
  });

  it("returns null for a host that is not a paired agent", () => {
    withNodes([node({})]);
    expect(pairedAgentDeviceIdForUrl("ws://192.168.1.50:8765/")).toBeNull();
  });

  it("returns null for an unparseable or empty url", () => {
    withNodes([node({})]);
    expect(pairedAgentDeviceIdForUrl("")).toBeNull();
    expect(pairedAgentDeviceIdForUrl("::::")).toBeNull();
  });
});
