import { describe, it, expect, beforeEach, vi } from "vitest";

import { createPluginBridge, type BridgeError } from "@/lib/plugins/bridge";
import { validateEnvelope } from "@/lib/plugins/envelope-dispatcher";
import {
  isKnownMethod,
  resolveRequiredCapability,
} from "@/lib/plugins/methods";
import type { PluginRpcEnvelope } from "@/lib/plugins/types";

interface FakeContentWindow {
  postMessage: ReturnType<typeof vi.fn>;
}

interface FakeIframe extends HTMLIFrameElement {
  contentWindow: WindowProxy;
}

function makeIframe(): { iframe: FakeIframe; cw: FakeContentWindow } {
  const cw: FakeContentWindow = { postMessage: vi.fn() };
  const iframe = document.createElement("iframe") as FakeIframe;
  Object.defineProperty(iframe, "contentWindow", {
    value: cw,
    writable: false,
  });
  return { iframe, cw };
}

function envelope(
  partial: Partial<PluginRpcEnvelope> & { id: string; method: string },
): PluginRpcEnvelope {
  return {
    type: "request",
    capability: partial.capability ?? "",
    args: partial.args ?? {},
    version: 1,
    ...partial,
  } as PluginRpcEnvelope;
}

describe("validateEnvelope", () => {
  it("accepts a well-formed request", () => {
    const env = envelope({ id: "r1", method: "ping" });
    expect(validateEnvelope(env)).toBe(true);
  });

  it("rejects wrong version", () => {
    expect(
      validateEnvelope({ ...envelope({ id: "r1", method: "ping" }), version: 2 }),
    ).toBe(false);
  });

  it("rejects missing id", () => {
    expect(
      validateEnvelope({
        type: "request",
        method: "ping",
        capability: "",
        args: {},
        version: 1,
      } as unknown),
    ).toBe(false);
  });

  it("rejects unknown type", () => {
    const env: unknown = {
      ...envelope({ id: "r1", method: "ping" }),
      type: "weird",
    };
    expect(validateEnvelope(env)).toBe(false);
  });
});

describe("createPluginBridge", () => {
  let iframe: FakeIframe;
  let cw: FakeContentWindow;
  let onSecurityEvent: (event: BridgeError & { method?: string }) => void;

  beforeEach(() => {
    ({ iframe, cw } = makeIframe());
    onSecurityEvent = vi.fn() as unknown as typeof onSecurityEvent;
  });

  it("dispatches a known method to its handler and posts the response", async () => {
    const handler = vi.fn(async () => ({ pong: true }));
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: { ping: handler },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "ping", capability: "" }),
      iframe.contentWindow,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cw.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "r1",
        type: "response",
        method: "ping",
        args: { pong: true },
      }),
      "*",
    );
    bridge.dispose();
  });

  it("rejects messages from a non-iframe source", async () => {
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: { ping: () => undefined },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "ping" }),
      ({} as unknown) as WindowProxy,
    );
    expect(cw.postMessage).not.toHaveBeenCalled();
    expect(onSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "origin_mismatch" }),
    );
    bridge.dispose();
  });

  it("returns method_unknown for unregistered methods", async () => {
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: {},
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "secret.dump" }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("method_unknown");
    bridge.dispose();
  });

  it("returns permission_denied when the plugin lacks a required capability", async () => {
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: { "command.send": () => undefined },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "command.send", args: {} }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("permission_denied");
    expect(onSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "permission_denied" }),
    );
    bridge.dispose();
  });

  it("dispatches when the granted set includes the resolved capability", async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set([
        "telemetry.subscribe.mavlink.attitude",
      ]),
      iframe,
      handlers: { "telemetry.subscribe": handler },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({
        id: "r1",
        method: "telemetry.subscribe",
        args: { topic: "mavlink.attitude" },
      }),
      iframe.contentWindow,
    );
    expect(handler).toHaveBeenCalled();
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error).toBeUndefined();
    expect(last.args).toEqual({ ok: true });
    bridge.dispose();
  });

  it("dispatches notification.publish when ui.slot.notification-channel is granted", async () => {
    const handler = vi.fn(() => ({ delivered: true }));
    const bridge = createPluginBridge({
      pluginId: "com.example.notify",
      grantedCapabilities: new Set(["ui.slot.notification-channel"]),
      iframe,
      handlers: { "notification.publish": handler },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({
        id: "r1",
        method: "notification.publish",
        args: { channelId: "alerts", severity: "info", title: "hi" },
      }),
      iframe.contentWindow,
    );
    expect(handler).toHaveBeenCalled();
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error).toBeUndefined();
    bridge.dispose();
  });

  it("rejects recording.mark without the recording.write capability", async () => {
    const bridge = createPluginBridge({
      pluginId: "com.example.rec",
      grantedCapabilities: new Set(),
      iframe,
      handlers: { "recording.mark": () => undefined },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "recording.mark", args: { label: "x" } }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("permission_denied");
    bridge.dispose();
  });

  it("rejects a method that requires a topic when args.topic is missing", async () => {
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: { "events.publish": () => undefined },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "events.publish", args: {} }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("schema_invalid");
    bridge.dispose();
  });

  it("returns handler_unset when the method is gated but no handler is wired", async () => {
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(["mission.read"]),
      iframe,
      handlers: {},
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "mission.read" }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    const err = last.error as BridgeError | undefined;
    expect(err?.code).toBe("handler_unset");
    bridge.dispose();
  });

  it("converts handler exceptions to a handler_error response", async () => {
    const handler = vi.fn(() => {
      throw new Error("boom");
    });
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: { ping: handler },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "ping" }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("handler_error");
    expect(last.error?.message).toBe("boom");
    bridge.dispose();
  });

  it("re-reads the granted-capability set per dispatch when given a getter", async () => {
    let caps = new Set<string>();
    const handler = vi.fn(() => ({ ok: true }));
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: () => caps,
      iframe,
      handlers: { "mission.read": handler },
      onSecurityEvent,
    });
    // First dispatch: empty caps -> denied.
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "mission.read" }),
      iframe.contentWindow,
    );
    expect(
      (cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope).error?.code,
    ).toBe("permission_denied");
    // Operator grants the capability mid-life. No bridge re-mount.
    caps = new Set(["mission.read"]);
    await bridge.handleEnvelope(
      envelope({ id: "r2", method: "mission.read" }),
      iframe.contentWindow,
    );
    const second = cw.postMessage.mock.calls[1][0] as PluginRpcEnvelope;
    expect(second.error).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });

  it("ignores response and event envelopes (host only routes requests)", async () => {
    const handler = vi.fn();
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: { ping: handler },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      envelope({ id: "r1", method: "ping", type: "response" }),
      iframe.contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(cw.postMessage).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it("answers schema_invalid when a topic method arrives with null or missing args", async () => {
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(["event.subscribe", "telemetry.subscribe"]),
      iframe,
      handlers: {},
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      { ...envelope({ id: "r1", method: "events.subscribe" }), args: null },
      iframe.contentWindow,
    );
    await bridge.handleEnvelope(
      { ...envelope({ id: "r2", method: "telemetry.subscribe" }), args: undefined },
      iframe.contentWindow,
    );
    const replies = cw.postMessage.mock.calls.map((c) => c[0] as PluginRpcEnvelope);
    expect(replies.map((r) => [r.id, r.error?.code])).toEqual([
      ["r1", "schema_invalid"],
      ["r2", "schema_invalid"],
    ]);
    bridge.dispose();
  });

  it("treats Object.prototype names as unknown methods and never dispatches them", async () => {
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: {},
      onSecurityEvent,
    });
    for (const [i, method] of ["constructor", "toString", "__proto__", "hasOwnProperty"].entries()) {
      await bridge.handleEnvelope(envelope({ id: `r${i}`, method }), iframe.contentWindow);
    }
    const codes = cw.postMessage.mock.calls.map(
      (c) => (c[0] as PluginRpcEnvelope).error?.code,
    );
    expect(codes).toEqual(["method_unknown", "method_unknown", "method_unknown", "method_unknown"]);
    bridge.dispose();
  });
});

describe("PLUGIN_METHOD_RULES — notification.publish + recording.mark", () => {
  it("registers both as known methods", () => {
    expect(isKnownMethod("notification.publish")).toBe(true);
    expect(isKnownMethod("recording.mark")).toBe(true);
  });

  it("gates notification.publish and notify on ui.slot.notification-channel", () => {
    expect(resolveRequiredCapability("notification.publish", {})).toBe(
      "ui.slot.notification-channel",
    );
    expect(resolveRequiredCapability("notify", {})).toBe(
      "ui.slot.notification-channel",
    );
  });

  it("gates recording.mark on recording.write", () => {
    expect(resolveRequiredCapability("recording.mark", {})).toBe(
      "recording.write",
    );
  });

  it("does not resolve inherited names through the prototype chain", () => {
    for (const name of ["constructor", "toString", "__proto__", "valueOf"]) {
      expect(isKnownMethod(name)).toBe(false);
      expect(resolveRequiredCapability(name, {})).toBeUndefined();
    }
  });
});
