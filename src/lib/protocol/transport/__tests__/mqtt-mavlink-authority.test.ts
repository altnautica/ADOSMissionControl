/**
 * @description Publish authority on the relay transport.
 *
 * The defect: the broker authorises subscribing and publishing separately, so
 * the shared read-only credential opens a healthy socket that streams telemetry
 * and silently discards every frame sent back. At QoS 0 nothing is
 * acknowledged, so neither the transport nor the caller can observe the
 * discard — the transport has to know its own authority rather than discover it.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MqttMavlinkTransport } from "../mqtt-mavlink";
import {
  onBrokerWriteAccepted,
  setMqttBrokerCredential,
} from "@/lib/mqtt-broker-credential";

/** Minimal stand-in for an mqtt.js client that connects successfully. */
function fakeClient() {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  return {
    published: [] as string[],
    on(event: string, cb: (...a: unknown[]) => void) {
      (handlers[event] ??= []).push(cb);
      // Report a successful connection as soon as the caller subscribes to it,
      // mirroring a broker that accepts CONNECT from a read-only credential.
      if (event === "connect") queueMicrotask(() => cb());
    },
    subscribe(_t: string, _o: unknown, cb?: (e: Error | null) => void) {
      cb?.(null);
    },
    publish(topic: string, _p: unknown, _o: unknown, cb?: (e?: Error) => void) {
      this.published.push(topic);
      cb?.(undefined);
    },
    end() {},
  };
}

let client: ReturnType<typeof fakeClient>;

beforeEach(() => {
  client = fakeClient();
  vi.doMock("mqtt", () => ({ connect: () => client }));
});

afterEach(() => {
  vi.doUnmock("mqtt");
  vi.resetModules();
});

async function connected(auth?: {
  username?: string;
  password?: string;
  canPublish?: boolean;
}) {
  const t = new MqttMavlinkTransport("mavlink");
  await t.connect("device-alpha", "ws://broker.invalid", auth);
  return t;
}

describe("MqttMavlinkTransport publish authority", () => {
  it("reports no command authority for the shared read-only credential", async () => {
    const t = await connected({ username: "viewer", password: "secret" });
    // Connected, and unable to command. Both at once is the whole point: this
    // is the state that previously rendered as a fully live link.
    expect(t.isConnected).toBe(true);
    expect(t.canCommand).toBe(false);
  });

  it("refuses to send on a receive-only credential instead of publishing", async () => {
    const t = await connected({ username: "viewer", password: "secret" });
    expect(() => t.send(new Uint8Array([1, 2, 3]))).toThrow(/receive-only/i);
    // The load-bearing assertion: nothing reached the broker. A publish that
    // is dropped downstream is indistinguishable from success at QoS 0, so the
    // frame must not leave at all.
    expect(client.published).toHaveLength(0);
  });

  it("reports command authority when the credential may publish", async () => {
    const t = await connected({
      username: "gcs-op-x",
      password: "secret",
      canPublish: true,
    });
    expect(t.canCommand).toBe(true);
    t.send(new Uint8Array([1]));
    expect(client.published).toEqual(["ados/device-alpha/mavlink/rx"]);
  });

  it("fails closed when no credential is supplied at all", async () => {
    const t = await connected(undefined);
    expect(t.canCommand).toBe(false);
  });

  it("does not grant authority from the claim alone", async () => {
    // canPublish without a usable credential is not authority — the broker
    // authorises a principal, and an anonymous connection has none.
    const t = await connected({ canPublish: true });
    expect(t.canCommand).toBe(false);
  });

  it("reports the broker's acceptance of a publish, once per credential", async () => {
    // Holding a grant and having proven it are different facts, and only the
    // publishing client can observe the second one: at QoS 0 there is no round
    // trip for the grant owner to wait on, so the broker taking the frame is the
    // only evidence that exists.
    setMqttBrokerCredential({ username: "gcs-op-x", password: "secret" });
    const accepted: string[] = [];
    const off = onBrokerWriteAccepted((username) => accepted.push(username));
    const t = await connected({
      username: "gcs-op-x",
      password: "secret",
      canPublish: true,
    });

    t.send(new Uint8Array([1]));
    t.send(new Uint8Array([2]));
    // Two frames, one report. This runs on every outbound FC frame, and a report
    // per frame would be a Convex mutation per frame.
    expect(accepted).toEqual(["gcs-op-x"]);

    off();
    setMqttBrokerCredential(null);
  });

  it("reports nothing when the session was refused the publish", async () => {
    setMqttBrokerCredential({ username: "viewer", password: "secret" });
    const accepted: string[] = [];
    const off = onBrokerWriteAccepted((username) => accepted.push(username));
    const t = await connected({ username: "viewer", password: "secret" });

    expect(() => t.send(new Uint8Array([1]))).toThrow(/receive-only/i);
    expect(accepted).toEqual([]);

    off();
    setMqttBrokerCredential(null);
  });
});
