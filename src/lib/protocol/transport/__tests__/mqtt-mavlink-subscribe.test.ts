/**
 * @module protocol/transport/mqtt-mavlink-subscribe.test
 * @description The relay transport's subscribe contract, driven through a fake
 * broker rather than asserted against the source text.
 *
 * Two behaviours, both of which fail silently when broken, which is why they
 * need a test at all:
 *
 * - mqtt.js fires `connect` on every successful reconnect, and with
 *   `clean: true` the broker discards the prior session's subscriptions. A
 *   transport that subscribes once outside the handler comes back from a
 *   reconnect with an open, healthy socket and no subscriptions, waiting
 *   forever for frames that will never arrive.
 * - A broker can accept CONNECT and then refuse SUBSCRIBE on an ACL. Without
 *   an error callback the refusal is invisible and looks identical to a
 *   vehicle that has stopped transmitting.
 *
 * This replaces a file that asserted both by regexing the module's source for
 * an identifier name. That test could not fail on a behavioural regression and
 * did fail on a rename that preserved the behaviour exactly — the failure mode
 * this suite is meant to be the answer to.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MqttMavlinkTransport } from "../mqtt-mavlink";

interface SubscribeCall {
  topic: unknown;
  hasErrorCallback: boolean;
}

/** A broker that accepts CONNECT and can be told how to answer SUBSCRIBE. */
function fakeBroker(opts: { subscribeError?: Error } = {}) {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  return {
    subscribes: [] as SubscribeCall[],
    ended: false,
    on(event: string, cb: (...a: unknown[]) => void) {
      (handlers[event] ??= []).push(cb);
      if (event === "connect") queueMicrotask(() => cb());
      return this;
    },
    /** Re-fire an event, the way mqtt.js does on a reconnect. */
    fire(event: string, ...args: unknown[]) {
      for (const cb of handlers[event] ?? []) cb(...args);
    },
    subscribe(topic: unknown, _o: unknown, cb?: (e: Error | null) => void) {
      this.subscribes.push({ topic, hasErrorCallback: typeof cb === "function" });
      cb?.(opts.subscribeError ?? null);
    },
    publish(_t: string, _p: unknown, _o: unknown, cb?: (e?: Error) => void) {
      cb?.(undefined);
    },
    end() {
      this.ended = true;
    },
  };
}

let broker: ReturnType<typeof fakeBroker>;

function install(opts: { subscribeError?: Error } = {}) {
  broker = fakeBroker(opts);
  vi.doMock("mqtt", () => ({ connect: () => broker }));
}

afterEach(() => {
  vi.doUnmock("mqtt");
  vi.resetModules();
});

// The transport itself imports `mqtt` lazily at connect time (see
// `mqtt-mavlink.ts`), which is what lets `vi.doMock` take effect against a
// statically imported transport — the same arrangement the sibling authority
// suite uses.
async function connect() {
  const t = new MqttMavlinkTransport("mavlink");
  await t.connect("device-alpha", "ws://broker.invalid", {
    username: "op",
    password: "secret",
    canPublish: true,
  });
  return t;
}

describe("MqttMavlinkTransport subscribe contract", () => {
  it("subscribes once the broker reports connected", async () => {
    install();
    await connect();
    expect(broker.subscribes.length).toBeGreaterThan(0);
  });

  it("resubscribes on a reconnect, because the broker discarded the session", async () => {
    install();
    await connect();
    const first = broker.subscribes.length;
    expect(first).toBeGreaterThan(0);

    // mqtt.js fires `connect` again on every successful reconnect.
    broker.fire("connect");

    expect(
      broker.subscribes.length,
      "a transport that subscribes outside the connect handler comes back deaf",
    ).toBeGreaterThan(first);
  });

  it("passes an error callback, so an ACL refusal cannot pass for silence", async () => {
    install();
    await connect();
    for (const call of broker.subscribes) {
      expect(call.hasErrorCallback).toBe(true);
    }
  });

  it("surfaces a refused subscription as an error instead of swallowing it", async () => {
    install({ subscribeError: new Error("not authorized") });
    const t = await connect();

    const seen: unknown[] = [];
    t.on("error", (e) => seen.push(e));

    // Re-fire connect so the refusal happens with a listener attached; the
    // point is that the transport emits rather than absorbing it.
    broker.fire("connect");

    expect(seen.length, "a refused subscribe must reach the caller").toBeGreaterThan(0);
    expect(String(seen[0])).toMatch(/not authorized|subscribe/i);
  });
});
