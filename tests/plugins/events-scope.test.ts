/**
 * @license GPL-3.0-only
 *
 * The plugin event bus is shared by every plugin on the page. A plugin's
 * agent-published state must reach only that plugin, and a plugin's own topic
 * namespace must not be writable by another plugin.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

import type { BridgeHandlerContext } from "@/lib/plugins/bridge";
import {
  agentStateOrigin,
  publishPluginEvent,
  resetPluginEventBus,
} from "@/lib/plugins/event-bus";
import { buildEventHandlers, MAX_EVENT_PAYLOAD_BYTES } from "@/lib/plugins/handlers/events";
import { testMount } from "@/lib/plugins/handlers/__tests__/test-mount";

function ctxFor(pluginId: string) {
  const postEvent = vi.fn();
  const ctx: BridgeHandlerContext = {
    pluginId,
    capability: "event.subscribe",
    postEvent,
    mount: testMount(),
    claims: null,
  };
  return { ctx, postEvent };
}

afterEach(() => resetPluginEventBus());

describe("plugin event scoping", () => {
  it("never hands another plugin's agent state to a wildcard subscriber", async () => {
    const { handlers } = buildEventHandlers("com.example.b");
    const { ctx, postEvent } = ctxFor("com.example.b");
    await handlers["events.subscribe"]({ topic: "*" }, ctx);

    publishPluginEvent("plugin.com.example.a.state", { lock: "on" }, agentStateOrigin("com.example.a", "d1"));
    publishPluginEvent("custom.ping", { n: 1 }, "com.example.a");

    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(postEvent).toHaveBeenCalledWith("custom.ping", "event.subscribe", { n: 1 });
  });

  it("refuses a publish into another plugin's namespace and allows its own", async () => {
    const { handlers } = buildEventHandlers("com.example.b");
    const { ctx } = ctxFor("com.example.b");

    const forged = await handlers["events.publish"]({ topic: "plugin.com.example.a.state", payload: 1 }, ctx);
    expect(forged).toMatchObject({ ok: false });

    const own = await handlers["events.publish"]({ topic: "plugin.com.example.b.state", payload: 1 }, ctx);
    expect(own).toEqual({ ok: true });
  });

  it("refuses a publish outside the plugin's own namespace, so host topics cannot be forged", async () => {
    const { handlers } = buildEventHandlers("com.example.b");
    const { ctx } = ctxFor("com.example.b");

    for (const topic of ["follow.state", "siyi.pod.state", "vehicle.armed", "plugin.com.example.b"]) {
      const out = await handlers["events.publish"]({ topic, payload: { active: true } }, ctx);
      expect(out).toMatchObject({ ok: false });
    }
  });

  it("refuses a payload over the size cap", async () => {
    const { handlers } = buildEventHandlers("com.example.b");
    const { ctx } = ctxFor("com.example.b");

    const out = await handlers["events.publish"](
      { topic: "plugin.com.example.b.blob", payload: "x".repeat(MAX_EVENT_PAYLOAD_BYTES) },
      ctx,
    );
    expect(out).toMatchObject({ ok: false });
  });
});
