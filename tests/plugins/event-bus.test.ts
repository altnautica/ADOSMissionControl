/**
 * Tests for the plugin event bus transport.
 *
 * @license GPL-3.0-only
 */
import { describe, it, expect, afterEach, vi } from "vitest";

import {
  publishPluginEvent,
  subscribePluginEvent,
  pluginEventBusStats,
  resetPluginEventBus,
  MAX_QUEUE,
} from "@/lib/plugins/event-bus";

afterEach(() => resetPluginEventBus());

describe("plugin event bus", () => {
  it("delivers a published event to an exact-topic subscriber", () => {
    const cb = vi.fn();
    subscribePluginEvent("plugin.foo.result", "sub-a", cb);

    publishPluginEvent("plugin.foo.result", { v: 1 }, "pub-a");

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ v: 1 }, "plugin.foo.result", "pub-a");
  });

  it("does not deliver to a non-matching exact subscriber", () => {
    const cb = vi.fn();
    subscribePluginEvent("plugin.foo.result", "sub-a", cb);

    publishPluginEvent("plugin.bar.result", { v: 1 }, "pub-a");

    expect(cb).not.toHaveBeenCalled();
  });

  it("matches a trailing-wildcard subscription under the prefix", () => {
    const cb = vi.fn();
    subscribePluginEvent("plugin.foo.*", "sub-a", cb);

    publishPluginEvent("plugin.foo.bar", "x", "pub-a");
    publishPluginEvent("plugin.foo.bar.baz", "y", "pub-a");
    publishPluginEvent("plugin.other.bar", "z", "pub-a");

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, "x", "plugin.foo.bar", "pub-a");
    expect(cb).toHaveBeenNthCalledWith(2, "y", "plugin.foo.bar.baz", "pub-a");
  });

  it("the bare `*` wildcard matches every topic", () => {
    const cb = vi.fn();
    subscribePluginEvent("*", "sub-a", cb);

    publishPluginEvent("anything.at.all", 1, "pub-a");
    publishPluginEvent("vehicle.armed", 2, "pub-a");

    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("delivers the same event to multiple subscribers", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribePluginEvent("vehicle.armed", "sub-a", a);
    subscribePluginEvent("vehicle.*", "sub-b", b);

    publishPluginEvent("vehicle.armed", true, "pub-a");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops delivery after unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribePluginEvent("plugin.foo.result", "sub-a", cb);

    publishPluginEvent("plugin.foo.result", 1, "pub-a");
    unsub();
    publishPluginEvent("plugin.foo.result", 2, "pub-a");

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(1, "plugin.foo.result", "pub-a");
  });

  it("unsubscribe is idempotent", () => {
    const cb = vi.fn();
    const unsub = subscribePluginEvent("plugin.foo.result", "sub-a", cb);
    unsub();
    expect(() => unsub()).not.toThrow();
    expect(pluginEventBusStats().subscriptions).toBe(0);
  });

  it("one throwing subscriber does not break delivery for others", () => {
    const order: string[] = [];
    subscribePluginEvent("plugin.foo.result", "sub-bad", () => {
      order.push("bad");
      throw new Error("boom");
    });
    const good = vi.fn(() => order.push("good"));
    subscribePluginEvent("plugin.foo.result", "sub-good", good);

    expect(() =>
      publishPluginEvent("plugin.foo.result", 1, "pub-a"),
    ).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["bad", "good"]);
  });

  it("re-entrant delivery is handled without recursing the drain loop", () => {
    const received: number[] = [];
    subscribePluginEvent("plugin.echo", "sub-a", (payload) => {
      const n = payload as number;
      received.push(n);
      if (n < 3) {
        // Re-enter publish from inside the callback.
        publishPluginEvent("plugin.echo", n + 1, "pub-a");
      }
    });

    publishPluginEvent("plugin.echo", 1, "pub-a");

    expect(received).toEqual([1, 2, 3]);
  });

  it("drops oldest and counts when a callback floods past the queue cap", () => {
    let flooded = false;
    subscribePluginEvent("plugin.flood", "sub-a", () => {
      if (flooded) return;
      flooded = true;
      // First delivery floods its own topic. The outer drain already shifted
      // this event, so the queue starts empty; FLOOD_N pushes overflow the cap.
      const FLOOD_N = MAX_QUEUE + 44;
      for (let i = 0; i < FLOOD_N; i += 1) {
        publishPluginEvent("plugin.flood", i, "pub-a");
      }
    });

    publishPluginEvent("plugin.flood", -1, "pub-a");

    // (MAX_QUEUE + 44) enqueued into an empty queue → 44 dropped (oldest).
    expect(pluginEventBusStats().droppedTotal).toBe(44);
  });

  it("reset clears subscriptions and counters", () => {
    subscribePluginEvent("plugin.foo.result", "sub-a", vi.fn());
    publishPluginEvent("plugin.foo.result", 1, "pub-a");
    expect(pluginEventBusStats().subscriptions).toBe(1);

    resetPluginEventBus();

    const stats = pluginEventBusStats();
    expect(stats.subscriptions).toBe(0);
    expect(stats.droppedTotal).toBe(0);
  });
});
