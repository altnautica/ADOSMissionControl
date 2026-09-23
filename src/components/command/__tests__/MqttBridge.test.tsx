/**
 * @license GPL-3.0-only
 *
 * The MQTT bridges dial only the broker the deployment configured. The broker
 * URL (resolved from clientConfig) and the broker credential (the operator's
 * own minted write grant) both land after the first render. The URL is a prop;
 * the credential is not — it is read at connect time from the singleton every
 * MQTT client shares, and the grant store's credential epoch is what re-runs
 * the connect effect when it changes.
 *
 * What must hold: nothing dials before the configured URL arrives (never a
 * built-in default broker), the fleet bridge never dials anonymously and
 * listens for client errors, and a renewed credential reconnects. The agent's
 * status document overlays only the FC-link fields it carries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, waitFor } from "@testing-library/react";

interface FakeClient {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(() => ({
  connect:
    vi.fn<(url: string, opts: Record<string, unknown>) => FakeClient>(),
}));

// The bridge dynamically imports "mqtt"; intercept both the connect fn and the
// returned client so we can observe the URL + options each connect used.
vi.mock("mqtt", () => ({
  connect: (url: string, opts: Record<string, unknown>) => h.connect(url, opts),
}));

// useToast needs a provider in the tree; stub it to a no-op toaster.
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { MqttBridge, applyMqttStatusDoc } from "../MqttBridge";
import { CommandFleetMqttBridge } from "../CommandFleetMqttBridge";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";
import { setMqttBrokerCredential } from "@/lib/mqtt-broker-credential";
import type { AgentStatus } from "@/lib/agent/types";
import type { PairedDrone } from "@/stores/pairing-store";

const BROKER = "wss://broker.example/mqtt";

const clients: FakeClient[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  clients.length = 0;
  h.connect.mockImplementation(() => {
    const c: FakeClient = { on: vi.fn(), subscribe: vi.fn(), end: vi.fn() };
    clients.push(c);
    return c;
  });
  // The effect early-returns without a cloud device id.
  useAgentConnectionStore.setState({ cloudDeviceId: "cloud-1" });
});

afterEach(() => {
  setMqttBrokerCredential(null);
  useMqttControlGrantStore.setState({ credentialEpoch: 0 });
});

describe("MqttBridge — broker and credentials arrive late", () => {
  it("dials nothing until the configured broker resolves, then dials it with creds", async () => {
    const { rerender } = render(<MqttBridge mqttBrokerUrl={undefined} />);
    // clientConfig has not resolved: no broker is configured yet, so no dial.
    await act(async () => {});
    expect(h.connect).not.toHaveBeenCalled();

    // clientConfig resolves → the real broker arrives on props. The grant is
    // minted and injected into the singleton, and the epoch bump is what tells
    // the effect the credential has landed.
    setMqttBrokerCredential({ username: "gcs-op-abc", password: "pw" });
    useMqttControlGrantStore.setState({ credentialEpoch: 1 });
    rerender(<MqttBridge mqttBrokerUrl={BROKER} />);

    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(1));
    const [url, opts] = h.connect.mock.calls[0];
    expect(url).toBe(BROKER);
    expect(opts.username).toBe("gcs-op-abc");
    expect(opts.password).toBe("pw");
  });

  it("reconnects on an epoch bump alone, with the broker URL unchanged", async () => {
    // Renewal: same broker, new principal, and an MQTT client cannot swap
    // credentials on a live socket. Without the epoch in the deps the operator
    // would keep a socket authenticated as a principal the broker has revoked.
    setMqttBrokerCredential({ username: "gcs-op-first", password: "pw1" });
    useMqttControlGrantStore.setState({ credentialEpoch: 1 });
    const { rerender } = render(<MqttBridge mqttBrokerUrl={BROKER} />);
    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(1));
    expect(h.connect.mock.calls[0][1].username).toBe("gcs-op-first");

    setMqttBrokerCredential({ username: "gcs-op-second", password: "pw2" });
    useMqttControlGrantStore.setState({ credentialEpoch: 2 });
    rerender(<MqttBridge mqttBrokerUrl={BROKER} />);

    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(2));
    expect(h.connect.mock.calls[1][1].username).toBe("gcs-op-second");
    expect(h.connect.mock.calls[1][1].password).toBe("pw2");
    expect(clients[0].end).toHaveBeenCalled();
  });
});

describe("CommandFleetMqttBridge", () => {
  const paired = [{ _id: "row_1", deviceId: "cloud-1" } as PairedDrone];

  it("never dials anonymously or to an unconfigured broker", async () => {
    const { rerender } = render(
      <CommandFleetMqttBridge pairedDrones={paired} mqttBrokerUrl={undefined} />,
    );
    setMqttBrokerCredential({ username: "gcs-op-abc", password: "pw" });
    useMqttControlGrantStore.setState({ credentialEpoch: 1 });
    rerender(<CommandFleetMqttBridge pairedDrones={paired} mqttBrokerUrl={null} />);
    await act(async () => {});
    expect(h.connect).not.toHaveBeenCalled();

    setMqttBrokerCredential(null);
    useMqttControlGrantStore.setState({ credentialEpoch: 2 });
    rerender(<CommandFleetMqttBridge pairedDrones={paired} mqttBrokerUrl={BROKER} />);
    await act(async () => {});
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("dials the configured broker as the operator and handles client errors", async () => {
    setMqttBrokerCredential({ username: "gcs-op-abc", password: "pw" });
    useMqttControlGrantStore.setState({ credentialEpoch: 1 });
    render(<CommandFleetMqttBridge pairedDrones={paired} mqttBrokerUrl={BROKER} />);
    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(1));
    const [url, opts] = h.connect.mock.calls[0];
    expect(url).toBe(BROKER);
    expect(opts.username).toBe("gcs-op-abc");
    const events = clients[0].on.mock.calls.map((c) => c[0]);
    expect(events).toEqual(expect.arrayContaining(["error", "offline", "close"]));
  });
});

describe("applyMqttStatusDoc", () => {
  const heartbeatStatus = {
    version: "1.2.3",
    board: { name: "Board", model: "", tier: 2, ram_mb: 2048, cpu_cores: 4, vendor: "", soc: "", arch: "", hw_video_codecs: [] },
    health: { cpu_percent: 12, memory_percent: 30, disk_percent: 40, temperature: null, timestamp: "" },
    fc_connected: true,
    fc_port: "/dev/ttyACM0",
    fc_baud: 115200,
    transport_open: true,
    mavlink_alive: true,
    heartbeat_age_s: 0.4,
    fc_variant: "betaflight",
  } as AgentStatus;

  it("overlays the FC-link fields of the agent's document and keeps the rest", () => {
    useAgentSystemStore.setState({ status: heartbeatStatus });
    // The agent's status document (services/mqtt gateway).
    const applied = applyMqttStatusDoc("cloud-1", {
      device_id: "cloud-1",
      name: "drone",
      tier: 2,
      armed: false,
      fc_connected: false,
      mavlink_alive: false,
      heartbeat_age_s: 6.5,
    });
    expect(applied).toBe(true);
    const s = useAgentSystemStore.getState().status!;
    expect(s.fc_connected).toBe(false);
    expect(s.mavlink_alive).toBe(false);
    expect(s.heartbeat_age_s).toBe(6.5);
    expect(s.fc_variant).toBe("betaflight");
    expect(s.transport_open).toBe(true);
    expect(s.version).toBe("1.2.3");
    expect(s.board.ram_mb).toBe(2048);
  });

  it("ignores another device's document and needs a heartbeat status first", () => {
    useAgentSystemStore.setState({ status: heartbeatStatus });
    expect(applyMqttStatusDoc("cloud-1", { device_id: "cloud-2", fc_connected: false })).toBe(false);
    expect(useAgentSystemStore.getState().status!.fc_connected).toBe(true);
    useAgentSystemStore.setState({ status: null });
    expect(applyMqttStatusDoc("cloud-1", { device_id: "cloud-1", fc_connected: false })).toBe(false);
    expect(useAgentSystemStore.getState().status).toBeNull();
  });
});
