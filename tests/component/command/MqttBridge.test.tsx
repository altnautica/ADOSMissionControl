/**
 * MqttBridge subscription, error handling and teardown.
 *
 * Three live defects, each with a concrete operator-visible cost:
 *
 *   - NO 'error' LISTENER. mqtt.js `Client` extends EventEmitter, and an
 *     'error' event with no listener is rethrown as an uncaught exception. A
 *     broker outage — the ordinary failure this component exists to survive —
 *     escaped the component instead of degrading it.
 *   - EVERYTHING AT QoS 0. `subscribe(topic, cb)` defaults to QoS 0, so a
 *     dropped `status` frame left the node card reading the previous state
 *     until the next emission, and a dropped `plugin/update_available` event
 *     was simply never seen. Those are discrete control-plane events, not a
 *     stream where the next sample supersedes the last.
 *   - TEARDOWN CALLED `end()` ALONE, leaving every listener attached while the
 *     client drained. `cloudDeviceId` is in the effect's deps, so the effect
 *     re-runs on every node switch: one leaked listener set per switch, each
 *     still writing telemetry into stores for a device the component has
 *     stopped tracking.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// ── Fake mqtt client ────────────────────────────────────────

interface SubscribeCall {
  topics: Record<string, { qos: number }>;
}

class FakeMqttClient {
  listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  subscribeCalls: SubscribeCall[] = [];
  unsubscribed: string[][] = [];
  removeAllCalls = 0;
  endCalls: Array<boolean | undefined> = [];
  subscribeError: Error | null = null;

  on(event: string, cb: (...args: unknown[]) => void) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }

  subscribe(
    topics: Record<string, { qos: number }>,
    cb?: (err: Error | null) => void,
  ) {
    this.subscribeCalls.push({ topics });
    cb?.(this.subscribeError);
    return this;
  }

  unsubscribe(topics: string[]) {
    this.unsubscribed.push(topics);
    return this;
  }

  removeAllListeners() {
    this.removeAllCalls += 1;
    this.listeners.clear();
    return this;
  }

  end(force?: boolean) {
    this.endCalls.push(force);
    return this;
  }

  /** Fire an event the way the broker would. Throws if nothing is listening,
   *  which is exactly what a real EventEmitter does for 'error'. */
  emit(event: string, ...args: unknown[]) {
    const list = this.listeners.get(event);
    if (!list || list.length === 0) {
      throw new Error(`unhandled '${event}' event`);
    }
    for (const cb of list) cb(...args);
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.length ?? 0;
  }
}

let client: FakeMqttClient;

vi.mock("mqtt", () => ({
  connect: () => client,
}));

const setMqttConnected = vi.fn();
const setCloudStatus = vi.fn();

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({
      cloudDeviceId: "ados-x-0001",
      setCloudStatus,
      setMqttConnected,
    }),
}));

vi.mock("@/stores/pairing-store", () => ({
  usePairingStore: (sel: (s: unknown) => unknown) => sel({ pairedDrones: [] }),
}));

vi.mock("@/stores/local-nodes-store", () => ({
  useLocalNodesStore: (sel: (s: unknown) => unknown) => sel({ nodes: {} }),
}));

vi.mock("@/stores/agent-connection/cloud-state", () => ({
  // No LAN path resolves, so the cloud vision-detections topic is in scope.
  resolveLanAgentUrl: () => null,
}));

vi.mock("@/stores/mqtt-control-grant-store", () => ({
  useMqttControlGrantStore: (sel: (s: unknown) => unknown) =>
    sel({ credentialEpoch: 0 }),
}));

vi.mock("@/lib/mqtt-broker-credential", () => ({
  getMqttBrokerCredential: () => null,
}));

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast }),
}));

import { MqttBridge } from "@/components/command/MqttBridge";

const DEVICE = "ados-x-0001";

async function mount() {
  const view = render(<MqttBridge mqttBrokerUrl="ws://broker.invalid:9001" />);
  await waitFor(() => expect(client.listenerCount("connect")).toBe(1));
  return view;
}

beforeEach(() => {
  client = new FakeMqttClient();
  setMqttConnected.mockClear();
  setCloudStatus.mockClear();
  toast.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MqttBridge subscriptions", () => {
  it("subscribes control-plane topics at QoS 1 and streams at QoS 0", async () => {
    await mount();
    client.emit("connect");

    expect(client.subscribeCalls).toHaveLength(1);
    expect(client.subscribeCalls[0].topics).toEqual({
      [`ados/${DEVICE}/status`]: { qos: 1 },
      [`ados/${DEVICE}/plugin/update_available`]: { qos: 1 },
      [`ados/${DEVICE}/telemetry`]: { qos: 0 },
      [`ados/${DEVICE}/vision/detections`]: { qos: 0 },
    });
  });

  it("sends the whole set in ONE subscribe packet, so a reconnect is idempotent", async () => {
    await mount();
    client.emit("connect");
    client.emit("close");
    client.emit("connect");
    client.emit("close");
    client.emit("connect");

    // Three reconnects, three packets, each carrying the identical set. The
    // broker replaces an existing subscription for the same filter, so this
    // cannot accumulate duplicate subscriptions the way N sequential
    // per-topic calls interleaved with a reconnect could.
    expect(client.subscribeCalls).toHaveLength(3);
    const sets = client.subscribeCalls.map((c) => Object.keys(c.topics).sort());
    expect(sets[1]).toEqual(sets[0]);
    expect(sets[2]).toEqual(sets[0]);
  });

  it("reports NOT connected when the broker refuses the subscription", async () => {
    client.subscribeError = new Error("not authorised");
    await mount();
    client.emit("connect");

    // Connected-but-deaf must not read as connected: no message will ever
    // arrive on a refused subscription.
    expect(setMqttConnected).toHaveBeenLastCalledWith(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/subscription failed/i), "error");
  });
});

describe("MqttBridge failure handling", () => {
  it("handles 'error' instead of letting it escape as an uncaught exception", async () => {
    await mount();
    expect(client.listenerCount("error")).toBe(1);
    // `emit` throws when nothing is listening, mirroring EventEmitter.
    expect(() => client.emit("error", new Error("ECONNREFUSED"))).not.toThrow();
    expect(setMqttConnected).toHaveBeenLastCalledWith(false);
  });

  it("degrades on 'offline' and on 'close'", async () => {
    await mount();
    client.emit("connect");
    setMqttConnected.mockClear();
    client.emit("offline");
    expect(setMqttConnected).toHaveBeenLastCalledWith(false);
    setMqttConnected.mockClear();
    client.emit("close");
    expect(setMqttConnected).toHaveBeenLastCalledWith(false);
  });
});

describe("MqttBridge teardown", () => {
  it("unsubscribes, drops every listener, and force-closes on unmount", async () => {
    const view = await mount();
    client.emit("connect");

    view.unmount();
    await waitFor(() => expect(client.endCalls.length).toBe(1));

    expect(client.unsubscribed).toHaveLength(1);
    expect(client.unsubscribed[0].sort()).toEqual(
      [
        `ados/${DEVICE}/plugin/update_available`,
        `ados/${DEVICE}/status`,
        `ados/${DEVICE}/telemetry`,
        `ados/${DEVICE}/vision/detections`,
      ].sort(),
    );
    expect(client.removeAllCalls).toBe(1);
    expect(client.endCalls).toEqual([true]);
    // Nothing is left that could write into a store after unmount.
    expect(client.listenerCount("message")).toBe(0);
    expect(client.listenerCount("error")).toBe(0);
  });
});
