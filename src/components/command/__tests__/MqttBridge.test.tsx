/**
 * @license GPL-3.0-only
 *
 * A2 regression: the MqttBridge connect effect consumes the broker URL (resolved
 * from clientConfig) and the broker credential (the operator's own minted write
 * grant), both of which land after the first render. The URL is a prop; the
 * credential is not — it is read at connect time from the singleton every MQTT
 * client shares, because transports that no component owns read the same one.
 *
 * What must hold either way: when the credential arrives, the client tears down
 * and reconnects to the correct broker WITH it, instead of connecting once,
 * credential-less, to the default broker and never re-running. The reactive
 * trigger for that is the grant store's credential epoch, so this pins the epoch
 * and the singleton together — an epoch bump with no credential behind it would
 * reconnect anonymously, and a credential with no bump would never be dialled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

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

import { MqttBridge } from "../MqttBridge";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";
import { setMqttBrokerCredential } from "@/lib/mqtt-broker-credential";
import { OFFICIAL_MQTT_WS_URL } from "@/lib/config/endpoints";

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

describe("MqttBridge — credentials-arrive-late (A2)", () => {
  it("reconnects to the correct broker with creds when they arrive after mount", async () => {
    const { rerender } = render(<MqttBridge mqttBrokerUrl={undefined} />);

    // First connect fires before clientConfig resolves and before any grant is
    // minted: the default broker, no username (the credential-less path).
    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(1));
    const [firstUrl, firstOpts] = h.connect.mock.calls[0];
    expect(firstUrl).toBe(OFFICIAL_MQTT_WS_URL);
    expect(firstOpts.username).toBeUndefined();
    expect(firstOpts.password).toBeUndefined();

    // clientConfig resolves → the real broker arrives on props. The grant is
    // minted and injected into the singleton, and the epoch bump is what tells
    // the effect the credential it dialled with has been replaced.
    setMqttBrokerCredential({ username: "gcs-op-abc", password: "pw" });
    useMqttControlGrantStore.setState({ credentialEpoch: 1 });
    rerender(<MqttBridge mqttBrokerUrl={BROKER} />);

    // The effect re-runs: the stale client is torn down and a fresh one dials
    // the configured broker WITH credentials.
    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(2));
    const [secondUrl, secondOpts] = h.connect.mock.calls[1];
    expect(secondUrl).toBe(BROKER);
    expect(secondOpts.username).toBe("gcs-op-abc");
    expect(secondOpts.password).toBe("pw");
    // The first (credential-less) client was ended on reconnect.
    expect(clients[0].end).toHaveBeenCalled();
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
