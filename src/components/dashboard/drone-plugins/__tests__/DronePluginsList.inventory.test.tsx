/**
 * @license GPL-3.0-only
 *
 * Render tests for DronePluginsList's webapp inventory merge. The
 * Convex listForDevice query stays authoritative; this verifies
 * that entries reported by the agent heartbeat (and only by the
 * heartbeat, not the Convex table) are surfaced as additional
 * cards with the agent_webapp source tag.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, waitFor } from "@testing-library/react";
import messages from "../../../../../locales/en.json";

// The persisted stores capture localStorage at import; install a working one
// before they load.
vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
});

vi.mock("lucide-react", () =>
  new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === "__esModule") return false;
        return (props: Record<string, unknown>) => (
          <span data-testid={`icon-${String(name)}`} {...props} />
        );
      },
    },
  ),
);

// Convex query returns an empty install list so the only cards rendered
// come from the inventory store.
let convexRows: unknown[] = [];
let convexState: "skipped" | "loading" | "error" | "ready" = "ready";
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: () => (convexState === "ready" ? convexRows : undefined),
  useConvexSkipQueryState: () => ({
    data: convexState === "ready" ? convexRows : undefined,
    state: convexState,
  }),
}));

// The node's own install list over the LAN.
const lanList = vi.fn(async () => ({ installs: [] as unknown[] }));
vi.mock("@/lib/agent/plugin-client", () => ({
  PluginAgentClient: class {
    constructor(
      public baseUrl: string,
      public apiKey: string,
    ) {}
    list = lanList;
  },
}));

// Stub the card so the merge contract is observable without rendering
// the full Convex-bound install card.
vi.mock("../DronePluginCard", () => ({
  DronePluginCard: ({
    install,
  }: {
    install: {
      pluginId: string;
      source: string;
      status: string;
      modelStatus?: Array<{ state: string; model_id: string }>;
      serviceStatus?: Array<{ name: string; ready: boolean }>;
    };
  }) => (
    <div data-testid="card">
      {install.pluginId}|{install.source}|{install.status}
      {install.modelStatus
        ? `|models:${install.modelStatus
            .map((m) => `${m.model_id}:${m.state}`)
            .join(",")}`
        : ""}
      {install.serviceStatus
        ? `|services:${install.serviceStatus
            .map((s) => `${s.name}:${s.ready ? "up" : "down"}`)
            .join(",")}`
        : ""}
    </div>
  ),
}));

import { DronePluginsList } from "../DronePluginsList";
import { useAgentPluginInventoryStore } from "@/stores/agent-plugin-inventory-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

function renderList(agentId: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DronePluginsList agentId={agentId} emptyState={<span>empty</span>} />
    </NextIntlClientProvider>,
  );
}

describe("DronePluginsList inventory merge", () => {
  beforeEach(() => {
    convexRows = [];
    convexState = "ready";
    lanList.mockReset();
    lanList.mockImplementation(async () => ({ installs: [] }));
    useLocalNodesStore.setState({ nodes: [] });
    useAgentPluginInventoryStore.getState().clear();
  });

  it("surfaces agent-only inventory entries with agent_webapp source", () => {
    useAgentPluginInventoryStore.getState().setForDevice("drone-1", [
      { plugin_id: "com.example.webapp-only", version: "0.1.0", status: "running" },
    ]);
    renderList("drone-1");
    const card = screen.getByTestId("card");
    expect(card.textContent).toBe("com.example.webapp-only|agent_webapp|running");
  });

  it("does not duplicate inventory entries that are also in Convex", () => {
    convexRows = [
      {
        _id: "row-1",
        pluginId: "com.example.dup",
        name: "Dup",
        version: "1.0.0",
        risk: "low",
        source: "registry",
        status: "running",
        halves: ["agent"],
        deviceId: "drone-1",
      },
    ];
    useAgentPluginInventoryStore.getState().setForDevice("drone-1", [
      { plugin_id: "com.example.dup", version: "1.0.0", status: "running" },
      { plugin_id: "com.example.extra", version: "0.2.0", status: "enabled" },
    ]);
    renderList("drone-1");
    const cards = screen.getAllByTestId("card");
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.textContent)).toEqual([
      "com.example.dup|registry|running",
      "com.example.extra|agent_webapp|enabled",
    ]);
  });

  it("passes the agent-reported model_status through to the card", () => {
    useAgentPluginInventoryStore.getState().setForDevice("drone-1", [
      {
        plugin_id: "com.altnautica.detector",
        version: "0.1.0",
        status: "running",
        model_status: [
          { state: "resolved", model_id: "coco-detector", path: "/x.onnx" },
          { state: "needs_model", model_id: "thermal", reason: "not cached" },
        ],
      },
    ]);
    renderList("drone-1");
    const card = screen.getByTestId("card");
    expect(card.textContent).toContain(
      "models:coco-detector:resolved,thermal:needs_model",
    );
  });

  it("passes the agent-reported service_status through to the card", () => {
    useAgentPluginInventoryStore.getState().setForDevice("drone-1", [
      {
        plugin_id: "com.altnautica.daemon",
        version: "0.1.0",
        status: "running",
        service_status: [
          { name: "worker", ready: true, reason: null },
          { name: "sensor", ready: false, reason: "unit not active" },
        ],
      },
    ]);
    renderList("drone-1");
    const card = screen.getByTestId("card");
    expect(card.textContent).toContain("services:worker:up,sensor:down");
  });

  it("scopes inventory to its own deviceId", () => {
    useAgentPluginInventoryStore.getState().setForDevice("drone-2", [
      { plugin_id: "com.example.other-drone", version: "0.1.0", status: "running" },
    ]);
    renderList("drone-1");
    expect(screen.queryByTestId("card")).toBeNull();
  });

  it("clears agent-only entries when the heartbeat reports an empty inventory", () => {
    useAgentPluginInventoryStore.getState().setForDevice("drone-1", [
      { plugin_id: "com.example.first", version: "0.1.0", status: "running" },
    ]);
    const view = renderList("drone-1");
    expect(view.queryAllByTestId("card")).toHaveLength(1);

    useAgentPluginInventoryStore.getState().setForDevice("drone-1", []);
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DronePluginsList agentId="drone-1" emptyState={<span>empty</span>} />
      </NextIntlClientProvider>,
    );
    expect(view.queryByTestId("card")).toBeNull();
  });

  it("drops entries whose plugin_id fails the canonical regex", () => {
    useAgentPluginInventoryStore.getState().setForDevice("drone-1", [
      { plugin_id: "<script>alert(1)</script>", version: "0.1.0", status: "running" },
      { plugin_id: "Has Spaces", version: "0.1.0", status: "running" },
      { plugin_id: "com.altnautica.legit", version: "0.1.0", status: "running" },
    ]);
    renderList("drone-1");
    const cards = screen.getAllByTestId("card");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("com.altnautica.legit");
  });

  it("caps the inventory render at the hard ceiling", () => {
    const entries = Array.from({ length: 60 }).map((_, i) => ({
      plugin_id: `com.altnautica.cap-${i.toString().padStart(2, "0")}`,
      version: "0.1.0",
      status: "running" as const,
    }));
    useAgentPluginInventoryStore.getState().setForDevice("drone-1", entries);
    renderList("drone-1");
    expect(screen.getAllByTestId("card")).toHaveLength(50);
  });
});

describe("DronePluginsList without a Convex answer", () => {
  beforeEach(() => {
    convexRows = [];
    lanList.mockReset();
    lanList.mockImplementation(async () => ({ installs: [] }));
    useLocalNodesStore.setState({ nodes: [] });
    useAgentPluginInventoryStore.getState().clear();
  });

  it("shows the empty state, not Loading, when Convex is not configured", () => {
    convexState = "skipped";
    renderList("drone-1");
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.getByText("empty")).toBeTruthy();
  });

  it("shows the empty state when the install query failed", () => {
    convexState = "error";
    renderList("drone-1");
    expect(screen.getByText("empty")).toBeTruthy();
  });

  it("lists the plugins a LAN-paired node reports it has installed", async () => {
    convexState = "skipped";
    useLocalNodesStore.setState({
      nodes: [
        { deviceId: "drone-1", hostname: "http://192.168.1.50:8080", apiKey: "k" },
      ],
    } as never);
    lanList.mockImplementation(async () => ({
      installs: [
        {
          plugin_id: "com.example.lan-install",
          version: "1.2.0",
          source: "local_file",
          signer_id: null,
          status: "enabled",
        },
      ],
    }));
    renderList("drone-1");
    await waitFor(() =>
      expect(screen.getByTestId("card").textContent).toBe(
        "com.example.lan-install|local_file|enabled",
      ),
    );
  });

  it("keeps the Convex row when the LAN list reports the same plugin", async () => {
    convexState = "ready";
    convexRows = [
      {
        _id: "row-1",
        pluginId: "com.example.both",
        name: "Both",
        version: "1.0.0",
        source: "registry",
        status: "running",
        halves: ["agent"],
        deviceId: "drone-1",
      },
    ];
    useLocalNodesStore.setState({
      nodes: [
        { deviceId: "drone-1", hostname: "http://192.168.1.50:8080", apiKey: "k" },
      ],
    } as never);
    lanList.mockImplementation(async () => ({
      installs: [
        {
          plugin_id: "com.example.both",
          version: "1.0.0",
          source: "local_file",
          signer_id: null,
          status: "enabled",
        },
      ],
    }));
    renderList("drone-1");
    await waitFor(() => expect(lanList).toHaveBeenCalled());
    const cards = screen.getAllByTestId("card");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toBe("com.example.both|registry|running");
  });
});
