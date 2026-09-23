/**
 * @license GPL-3.0-only
 *
 * Tests for AgentMavlinkBridge, the owner of the agent FC session.
 * Authentication is orthogonal to the URL: the bridge dials the raw MAVLink
 * proxy URL for any profile and, when a pairing key is held, attaches a
 * freshly-minted ticket as a WebSocket subprotocol.
 *   - a pairing key is held → a ticket is minted and the raw URL is dialed
 *     with the ticket subprotocol;
 *   - no pairing key → the agent is asked whether it is paired. An unpaired
 *     agent refuses a keyless WebSocket off its own box and lifeline links, so
 *     on an ordinary LAN the dial is skipped and the pair-this-node state is
 *     raised; on a lifeline (hotspot) address the raw URL is dialed bare, and
 *     a refused dial there raises the same state;
 *   - a WebSocket failure falls through to the MQTT relay;
 *   - a missing session is re-dialled every 3 s with no cap, but a session the
 *     operator disconnected on purpose stays down.
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

// Shared mock state + spies. Declared via vi.hoisted so the hoisted
// vi.mock factories below can reference them safely.
const h = vi.hoisted(() => {
  const conn: { current: ConnState } = {
    current: {
      mavlinkUrl: null,
      connected: false,
      nodeDeviceId: null,
      agentUrl: null,
      cloudDeviceId: null,
      apiKey: null,
      setMavlinkPairRequired: () => {},
    },
  };
  return {
    conn,
    wsConnect:
      vi.fn<(url: string, protocols?: string | string[]) => Promise<void>>(),
    mqttConnect: vi.fn<
      (
        deviceId: string,
        brokerUrl?: string,
        auth?: { username?: string | null; password?: string | null; canPublish?: boolean },
      ) => Promise<void>
    >(),
    adapterConnect: vi.fn(async () => ({ firmware: "ardupilot" })),
    mintWsTicket: vi.fn<() => Promise<string | null>>(),
    probeAgent: vi.fn<(host: string) => Promise<{ paired: boolean }>>(),
    setMavlinkPairRequired: vi.fn<(required: boolean) => void>(),
    addDrone: vi.fn(),
    disconnectDrone: vi.fn(),
    selectDrone: vi.fn(),
    drones: new Map<string, { transport: { type: string } }>(),
    dropListeners: new Set<(droneId: string) => void>(),
  };
});

// --- Mocked transports (dynamically imported by the bridge) ----------------

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
vi.mock("@/lib/protocol/transport/mqtt-mavlink", () => ({
  MqttMavlinkTransport: class {
    connect(
      deviceId: string,
      brokerUrl?: string,
      auth?: { username?: string | null; password?: string | null; canPublish?: boolean },
    ) {
      return h.mqttConnect(deviceId, brokerUrl, auth);
    }
    disconnect() {}
  },
}));
vi.mock("@/lib/protocol/mavlink-adapter", () => ({
  MAVLinkAdapter: class {
    connect() {
      return h.adapterConnect();
    }
    disconnect() {
      return Promise.resolve();
    }
  },
}));

// --- Mocked ticket mint -----------------------------------------------------

vi.mock("@/lib/api/ground-station/ws-ticket", () => ({
  WS_TICKET_PROTOCOL: "ados-ws-ticket",
  mintWsTicket: (...args: unknown[]) => h.mintWsTicket(...(args as [])),
}));

// --- Mocked pairing probe (/api/pairing/info) -------------------------------

vi.mock("@/lib/agent/local-pair/probe", () => ({
  probeAgent: (host: string) => h.probeAgent(host),
}));

// --- Mocked stores ----------------------------------------------------------

vi.mock("@/stores/agent-connection-store", () => {
  const hook = (sel: (s: ConnState) => unknown) => sel(h.conn.current);
  hook.getState = () => h.conn.current;
  return { useAgentConnectionStore: hook };
});

vi.mock("@/stores/agent-system-store", () => {
  const state = { status: { fc_connected: true, board: { name: "Drone" } } };
  const hook = (sel: (s: typeof state) => unknown) => sel(state);
  hook.getState = () => state;
  return { useAgentSystemStore: hook };
});

vi.mock("@/stores/agent-capabilities-store", () => {
  const hook = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ mavlinkWsUrlPrev: null });
  return { useAgentCapabilitiesStore: hook };
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
    selectDrone: h.selectDrone,
  };
  const hook = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  hook.getState = () => state;
  return {
    useDroneManager: hook,
    onUnexpectedDisconnect: (listener: (droneId: string) => void) => {
      h.dropListeners.add(listener);
      return () => h.dropListeners.delete(listener);
    },
  };
});

vi.mock("@/stores/fleet-store", () => {
  const state = { drones: [] as unknown[] };
  const hook = () => state;
  hook.getState = () => state;
  return { useFleetStore: hook };
});

import { AgentMavlinkBridge } from "../AgentMavlinkBridge";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";
import { setMqttBrokerCredential } from "@/lib/mqtt-broker-credential";

const { wsConnect, mqttConnect, mintWsTicket, addDrone, probeAgent, setMavlinkPairRequired } = h;

/** Hold a live write grant covering the cloud device the bridge will dial. */
function holdGrant() {
  setMqttBrokerCredential({ username: "gcs-op-1", password: "secret-1" });
  useMqttControlGrantStore.setState({
    principal: "gcs-op-1",
    grant: {
      deviceIds: ["cloud-1"],
      expiresAt: Date.now() + 60 * 60 * 1000,
      writeConfirmed: false,
      renewalFailed: false,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  h.drones.clear();
  wsConnect.mockResolvedValue(undefined);
  mqttConnect.mockResolvedValue(undefined);
  mintWsTicket.mockResolvedValue("tok-xyz");
  probeAgent.mockResolvedValue({ paired: true });
  h.conn.current = {
    mavlinkUrl: "ws://drone.local:8765/",
    connected: true,
    nodeDeviceId: "dev-1",
    agentUrl: "http://drone.local:8080",
    cloudDeviceId: "cloud-1",
    apiKey: "key-abc",
    setMavlinkPairRequired,
  };
});

afterEach(() => {
  setMqttBrokerCredential(null);
  useMqttControlGrantStore.setState({
    grant: null,
    principal: null,
    minting: false,
    lastError: null,
  });
});

describe("AgentMavlinkBridge connection cascade", () => {
  it("mints a ticket and dials the raw URL with the subprotocol when a key is held", async () => {
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));
    expect(mintWsTicket).toHaveBeenCalledTimes(1);
    expect(wsConnect).toHaveBeenCalledTimes(1);
    const [url, protocols] = wsConnect.mock.calls[0];
    expect(url).toBe("ws://drone.local:8765/");
    expect(protocols).toEqual(["ados-ws-ticket", "tok-xyz"]);
    expect(mqttConnect).not.toHaveBeenCalled();
    // A held key never needs the pairing probe.
    expect(probeAgent).not.toHaveBeenCalled();
  });

  it("does not dial an unpaired agent keyless over the LAN and raises pair-this-node", async () => {
    h.conn.current.apiKey = null;
    h.conn.current.cloudDeviceId = null;
    probeAgent.mockResolvedValue({ paired: false });
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(setMavlinkPairRequired).toHaveBeenCalledWith(true));
    expect(probeAgent).toHaveBeenCalledWith("http://drone.local:8080");
    expect(wsConnect).not.toHaveBeenCalled();
    expect(addDrone).not.toHaveBeenCalled();
  });

  it("dials an unpaired agent bare on its hotspot address without asking first", async () => {
    h.conn.current = {
      ...h.conn.current,
      apiKey: null,
      mavlinkUrl: "ws://192.168.4.1:8765/",
      agentUrl: "http://192.168.4.1:8080",
    };
    probeAgent.mockResolvedValue({ paired: false });
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));
    expect(mintWsTicket).not.toHaveBeenCalled();
    expect(probeAgent).not.toHaveBeenCalled();
    const [url, protocols] = wsConnect.mock.calls[0];
    expect(url).toBe("ws://192.168.4.1:8765/");
    expect(protocols).toBeUndefined();
    expect(setMavlinkPairRequired).toHaveBeenCalledWith(false);
  });

  it("maps a refused keyless handshake from an unpaired agent to pair-this-node", async () => {
    h.conn.current = {
      ...h.conn.current,
      apiKey: null,
      cloudDeviceId: null,
      mavlinkUrl: "ws://192.168.4.1:8765/",
      agentUrl: "http://192.168.4.1:8080",
    };
    wsConnect.mockRejectedValue(new Error("WebSocket error"));
    probeAgent.mockResolvedValue({ paired: false });
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(setMavlinkPairRequired).toHaveBeenCalledWith(true));
    expect(wsConnect).toHaveBeenCalledTimes(1);
    expect(addDrone).not.toHaveBeenCalled();
  });

  it("still dials keyless when the agent reports itself paired", async () => {
    h.conn.current.apiKey = null;
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));
    expect(probeAgent).toHaveBeenCalledTimes(1);
    const [url, protocols] = wsConnect.mock.calls[0];
    expect(url).toBe("ws://drone.local:8765/");
    expect(protocols).toBeUndefined();
  });

  it("falls through to the MQTT relay when every WebSocket dial fails", async () => {
    wsConnect.mockRejectedValue(new Error("refused"));
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(mqttConnect).toHaveBeenCalledTimes(1));
    // Authenticated + legacy WS both attempted, both rejected.
    expect(wsConnect).toHaveBeenCalledTimes(2);
    // No grant held, so no publish claim is passed and the relay session is
    // receive-only. The transport refuses to infer authority from a credential
    // it was not told to publish with.
    expect(mqttConnect).toHaveBeenCalledWith("cloud-1", undefined, undefined);
    expect(addDrone).toHaveBeenCalledTimes(1);
  });

  it("carries the operator's write grant into the relay dial", async () => {
    holdGrant();
    wsConnect.mockRejectedValue(new Error("refused"));
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(mqttConnect).toHaveBeenCalledTimes(1));
    // The claim is what flips the transport's `canCommand`, and it comes from
    // the grant store rather than being inferred from an open socket.
    expect(mqttConnect).toHaveBeenCalledWith("cloud-1", undefined, {
      username: "gcs-op-1",
      password: "secret-1",
      canPublish: true,
    });
  });

  it("passes no claim when the held grant covers a different drone", async () => {
    holdGrant();
    useMqttControlGrantStore.setState({
      grant: {
        deviceIds: ["cloud-2"],
        expiresAt: Date.now() + 60 * 60 * 1000,
        writeConfirmed: false,
        renewalFailed: false,
      },
    });
    wsConnect.mockRejectedValue(new Error("refused"));
    render(<AgentMavlinkBridge />);

    await waitFor(() => expect(mqttConnect).toHaveBeenCalledTimes(1));
    expect(mqttConnect).toHaveBeenCalledWith("cloud-1", undefined, undefined);
  });
});

describe("AgentMavlinkBridge session supervision", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("re-dials a failing link every 3 s and never gives up", async () => {
    const at: number[] = [];
    wsConnect.mockRejectedValue(new Error("refused"));
    mqttConnect.mockImplementation(async () => {
      at.push(Date.now());
      throw new Error("broker down");
    });
    render(<AgentMavlinkBridge />);
    await vi.waitFor(() => expect(at).toHaveLength(1));

    // Two minutes of a dead link, stepped so each dial's awaits settle.
    for (let t = 0; t < 120_000; t += 500) {
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(at.length).toBeGreaterThanOrEqual(40);
    const gaps = at.slice(1).map((ts, i) => ts - at[i]);
    // A fixed interval: never faster than 3 s, and no backoff stretching it.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(3_000);
      expect(gap).toBeLessThan(3_600);
    }
    expect(addDrone).not.toHaveBeenCalled();
  });

  it("re-dials a session that dropped unexpectedly", async () => {
    render(<AgentMavlinkBridge />);
    await vi.waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));
    const droneId = addDrone.mock.calls[0][0] as string;

    // The transport closed on its own: drone-manager reports it, then drops it.
    for (const listener of h.dropListeners) listener(droneId);
    h.drones.delete(droneId);

    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(addDrone).toHaveBeenCalledTimes(2));
    expect(addDrone.mock.calls[1][0]).toBe(droneId);
  });

  it("leaves a session the operator disconnected on purpose down", async () => {
    render(<AgentMavlinkBridge />);
    await vi.waitFor(() => expect(addDrone).toHaveBeenCalledTimes(1));
    const droneId = addDrone.mock.calls[0][0] as string;

    const { useDroneManager } = await import("@/stores/drone-manager");
    useDroneManager.getState().disconnectDrone(droneId);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(wsConnect).toHaveBeenCalledTimes(1);
    expect(addDrone).toHaveBeenCalledTimes(1);
  });
});
