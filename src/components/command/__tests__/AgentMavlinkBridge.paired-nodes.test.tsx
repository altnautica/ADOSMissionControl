/**
 * @license GPL-3.0-only
 *
 * AgentMavlinkBridge keeps a session to every LAN-paired agent's FC, not only
 * to the agent the operator has focused. A full page load starts with no
 * focused agent, and leaving the node's page releases the focus, yet the
 * planner, the fleet and every other route still need the vehicle:
 *   - with no agent focused, each LAN-paired node whose agent reports an FC is
 *     dialled (ticketed WebSocket on the agent's MAVLink port) and attached to
 *     its `node:<deviceId>` row without taking the selection;
 *   - releasing the focus keeps the session open;
 *   - a failing dial is retried every 3 s with no cap;
 *   - the session closes when the agent reports the FC gone;
 *   - a ground station's MAVLink port republishes its whole fleet, so it is
 *     left to the relayed-drone bridge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

interface ConnState {
  mavlinkUrl: string | null;
  connected: boolean;
  nodeDeviceId: string | null;
  agentUrl: string | null;
  cloudDeviceId: string | null;
  apiKey: string | null;
  setMavlinkPairRequired: (required: boolean) => void;
}

const h = vi.hoisted(() => ({
  conn: { current: null as unknown as ConnState },
  sys: { status: null as null | { fc_connected?: boolean; board?: { name: string } } },
  wsConnect: vi.fn<(url: string, protocols?: string | string[]) => Promise<void>>(),
  mintWsTicket: vi.fn<(agent: { baseUrl: string; apiKey: string }, scope: string) => Promise<string | null>>(),
  setMavlinkPairRequired: vi.fn<(required: boolean) => void>(),
  addDrone: vi.fn(),
  disconnectDrone: vi.fn(),
  drones: new Map<string, { transport: { type: string } }>(),
}));

vi.mock("@/lib/protocol/transport/websocket", () => ({
  WebSocketTransport: class {
    readonly type = "websocket" as const;
    connect(url: string, protocols?: string | string[]) {
      return h.wsConnect(url, protocols);
    }
    disconnect() {
      return Promise.resolve();
    }
  },
}));
vi.mock("@/lib/protocol/mavlink-adapter", () => ({
  MAVLinkAdapter: class {
    connect() {
      return Promise.resolve({ firmware: "ardupilot" });
    }
    disconnect() {
      return Promise.resolve();
    }
  },
}));
vi.mock("@/lib/api/ground-station/ws-ticket", () => ({
  WS_TICKET_PROTOCOL: "ados-ws-ticket",
  mintWsTicket: (agent: { baseUrl: string; apiKey: string }, scope: string) =>
    h.mintWsTicket(agent, scope),
}));
vi.mock("@/stores/agent-connection-store", () => {
  const hook = (sel: (s: ConnState) => unknown) => sel(h.conn.current);
  hook.getState = () => h.conn.current;
  return { useAgentConnectionStore: hook };
});
vi.mock("@/stores/agent-system-store", () => {
  const hook = (sel: (s: typeof h.sys) => unknown) => sel(h.sys);
  hook.getState = () => h.sys;
  return { useAgentSystemStore: hook };
});
vi.mock("@/stores/drone-manager", () => {
  const state = {
    drones: h.drones,
    selectedDroneId: null,
    addDrone: (id: string, ...rest: unknown[]) => {
      const meta = rest[4] as { type: string };
      h.drones.set(id, { transport: { type: meta.type } });
      h.addDrone(id, ...rest);
    },
    disconnectDrone: (id: string) => {
      h.drones.delete(id);
      h.disconnectDrone(id);
    },
    selectDrone: vi.fn(),
  };
  const hook = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  hook.getState = () => state;
  return { useDroneManager: hook, onUnexpectedDisconnect: () => () => {} };
});

import { AgentMavlinkBridge } from "../AgentMavlinkBridge";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useDroneManager } from "@/stores/drone-manager";

const { wsConnect, mintWsTicket, addDrone, disconnectDrone } = h;

function lanNode(deviceId: string, octet: number, profile: LocalNode["profile"] = "drone"): LocalNode {
  return {
    deviceId,
    name: `Drone ${deviceId}`,
    hostname: `http://192.168.1.${octet}:8080`,
    apiKey: `key-${deviceId}`,
    profile,
    pairedAt: 1,
  };
}

function reportFc(deviceId: string, fcConnected: boolean) {
  useCommandFleetStore
    .getState()
    .upsertCloudStatuses([{ deviceId, fcConnected, updatedAt: Date.now() }]);
}

const UNFOCUSED: ConnState = {
  mavlinkUrl: null,
  connected: false,
  nodeDeviceId: null,
  agentUrl: null,
  cloudDeviceId: null,
  apiKey: null,
  setMavlinkPairRequired: (required) => h.setMavlinkPairRequired(required),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.drones.clear();
  wsConnect.mockResolvedValue(undefined);
  mintWsTicket.mockResolvedValue("tok-1");
  h.conn.current = { ...UNFOCUSED };
  h.sys.status = null;
  useLocalNodesStore.setState({ nodes: [] });
  useCommandFleetStore.setState({ cloudStatuses: {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentMavlinkBridge with no agent focused", () => {
  it("attaches every LAN-paired node whose agent reports an FC, as on a fresh page load", async () => {
    useLocalNodesStore.setState({ nodes: [lanNode("dev-a", 60), lanNode("dev-b", 61)] });
    reportFc("dev-a", true);
    reportFc("dev-b", true);
    // Hold the second node's ticket until the first is attached. vitest hands
    // the real module to the second of two concurrent dynamic imports of a
    // mocked one (the FC adapter is loaded lazily), so the two handshakes must
    // not overlap here; the bridge itself dials both at once.
    const second = Promise.withResolvers<void>();
    mintWsTicket.mockImplementation(async (agent) => {
      if (agent.apiKey === "key-dev-b") await second.promise;
      return "tok-1";
    });
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));
    // Both dials were already under way: the second only waits on its ticket.
    expect(mintWsTicket).toHaveBeenCalledTimes(2);
    second.resolve();
    await waitFor(() => expect(addDrone).toHaveBeenCalledTimes(2));
    expect(addDrone.mock.calls.map((c) => c[0]).sort()).toEqual(["node:dev-a", "node:dev-b"]);
    expect(wsConnect).toHaveBeenCalledWith("ws://192.168.1.60:8765/", ["ados-ws-ticket", "tok-1"]);
    expect(wsConnect).toHaveBeenCalledWith("ws://192.168.1.61:8765/", ["ados-ws-ticket", "tok-1"]);
    expect(mintWsTicket).toHaveBeenCalledWith(
      { baseUrl: "http://192.168.1.60:8080", apiKey: "key-dev-a" },
      "gs.mavlink_ws",
    );
    for (const call of addDrone.mock.calls) {
      // Attached onto the node's presence row; the operator's selection stays theirs.
      expect(call[6]).toEqual({ ownsFleetRow: false, autoSelect: false });
    }
    // A background dial never raises the focused agent's pair-this-node state.
    expect(h.setMavlinkPairRequired).not.toHaveBeenCalled();
  });

  it("dials nothing for a node whose agent has not reported an FC", async () => {
    useLocalNodesStore.setState({ nodes: [lanNode("dev-a", 60), lanNode("dev-b", 61)] });
    reportFc("dev-b", false);
    render(<AgentMavlinkBridge />);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mintWsTicket).not.toHaveBeenCalled();
    expect(wsConnect).not.toHaveBeenCalled();
  });

  it("leaves a ground station's MAVLink port to the relayed-drone bridge", async () => {
    useLocalNodesStore.setState({ nodes: [lanNode("gs-1", 70, "ground-station")] });
    reportFc("gs-1", true);
    render(<AgentMavlinkBridge />);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(wsConnect).not.toHaveBeenCalled();
  });

  it("re-dials a failing node every 3 s and never gives up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const at: number[] = [];
    mintWsTicket.mockImplementation(async () => {
      at.push(Date.now());
      return "tok-1";
    });
    wsConnect.mockRejectedValue(new Error("refused"));
    useLocalNodesStore.setState({ nodes: [lanNode("dev-a", 60)] });
    reportFc("dev-a", true);
    render(<AgentMavlinkBridge />);
    await vi.waitFor(() => expect(at).toHaveLength(1));

    for (let t = 0; t < 60_000; t += 500) {
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(at.length).toBeGreaterThanOrEqual(18);
    const gaps = at.slice(1).map((ts, i) => ts - at[i]);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(3_000);
      expect(gap).toBeLessThan(3_600);
    }
    expect(addDrone).not.toHaveBeenCalled();
  });

  it("closes the session when the agent reports the FC gone", async () => {
    useLocalNodesStore.setState({ nodes: [lanNode("dev-a", 60)] });
    reportFc("dev-a", true);
    const view = render(<AgentMavlinkBridge />);
    await waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));

    reportFc("dev-a", false);
    view.rerender(<AgentMavlinkBridge />);
    await waitFor(() => expect(disconnectDrone).toHaveBeenCalledWith("node:dev-a"));
  });
});

describe("AgentMavlinkBridge when the focus is released", () => {
  it("keeps a LAN-paired node's session after the operator leaves its page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    useLocalNodesStore.setState({ nodes: [lanNode("dev-a", 60)] });
    reportFc("dev-a", true);
    h.conn.current = {
      ...UNFOCUSED,
      connected: true,
      nodeDeviceId: "dev-a",
      mavlinkUrl: "ws://192.168.1.60:8765/",
      agentUrl: "http://192.168.1.60:8080",
      apiKey: "key-dev-a",
    };
    h.sys.status = { fc_connected: true, board: { name: "Drone" } };
    const view = render(<AgentMavlinkBridge />);
    await vi.waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));
    expect(addDrone.mock.calls[0][0]).toBe("node:dev-a");

    // Leaving the dashboard disconnects the focused agent, which clears its status.
    h.conn.current = { ...UNFOCUSED };
    h.sys.status = null;
    view.rerender(<AgentMavlinkBridge />);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(disconnectDrone).not.toHaveBeenCalled();
    expect(addDrone).toHaveBeenCalledTimes(1);
    expect(wsConnect).toHaveBeenCalledTimes(1);
  });

  it("keeps an FC the operator disconnected down after they leave its page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    useLocalNodesStore.setState({ nodes: [lanNode("dev-a", 60)] });
    reportFc("dev-a", true);
    const focused: ConnState = {
      ...UNFOCUSED,
      connected: true,
      nodeDeviceId: "dev-a",
      mavlinkUrl: "ws://192.168.1.60:8765/",
      agentUrl: "http://192.168.1.60:8080",
      apiKey: "key-dev-a",
    };
    h.conn.current = focused;
    h.sys.status = { fc_connected: true, board: { name: "Drone" } };
    const view = render(<AgentMavlinkBridge />);
    await vi.waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));

    // The operator disconnects the FC from the connections panel.
    useDroneManager.getState().disconnectDrone("node:dev-a");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(addDrone).toHaveBeenCalledTimes(1);

    // Leaving the node's page releases the focus: still down.
    h.conn.current = { ...UNFOCUSED };
    h.sys.status = null;
    view.rerender(<AgentMavlinkBridge />);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(addDrone).toHaveBeenCalledTimes(1);
    expect(wsConnect).toHaveBeenCalledTimes(1);

    // Opening the node again is the operator connecting it: dialled again.
    h.conn.current = focused;
    h.sys.status = { fc_connected: true, board: { name: "Drone" } };
    view.rerender(<AgentMavlinkBridge />);
    await vi.waitFor(() => expect(addDrone).toHaveBeenCalledTimes(2));
  });

  it("keeps an FC the operator disconnected down when the agent link drops and recovers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    useLocalNodesStore.setState({ nodes: [lanNode("dev-a", 60)] });
    reportFc("dev-a", true);
    const focused: ConnState = {
      ...UNFOCUSED,
      connected: true,
      nodeDeviceId: "dev-a",
      mavlinkUrl: "ws://192.168.1.60:8765/",
      agentUrl: "http://192.168.1.60:8080",
      apiKey: "key-dev-a",
    };
    h.conn.current = focused;
    h.sys.status = { fc_connected: true, board: { name: "Drone" } };
    const view = render(<AgentMavlinkBridge />);
    await vi.waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));

    useDroneManager.getState().disconnectDrone("node:dev-a");
    await vi.advanceTimersByTimeAsync(6_000);

    // The agent's polls fail long enough for the store to mark it offline,
    // then recover. The focused node never changed.
    h.conn.current = { ...focused, connected: false };
    view.rerender(<AgentMavlinkBridge />);
    await vi.advanceTimersByTimeAsync(6_000);
    h.conn.current = { ...focused };
    view.rerender(<AgentMavlinkBridge />);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(addDrone).toHaveBeenCalledTimes(1);
  });
});

describe("AgentMavlinkBridge with a focus that has no dial path", () => {
  it("runs no dial loop for a drone focused through a ground station", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A relay focus carries no MAVLink URL and no cloud id of its own.
    h.conn.current = { ...UNFOCUSED, connected: true, nodeDeviceId: "dev-r" };
    h.sys.status = { fc_connected: true, board: { name: "Relayed" } };
    render(<AgentMavlinkBridge />);
    await vi.advanceTimersByTimeAsync(15_000);
    const failures = warn.mock.calls.filter((c) =>
      String(c[0]).includes("All MAVLink connection methods failed"),
    );
    warn.mockRestore();
    expect(failures).toHaveLength(0);
    expect(wsConnect).not.toHaveBeenCalled();
  });
});
