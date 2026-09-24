import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { createPluginBridge, type BridgeError } from "@/lib/plugins/bridge";
import { validateEnvelope } from "@/lib/plugins/envelope-dispatcher";
import { PluginIframeHost } from "@/components/plugins/PluginIframeHost";
import type { PluginRpcEnvelope } from "@/lib/plugins/types";

interface FakeContentWindow {
  postMessage: ReturnType<typeof vi.fn>;
}

function makeIframe(): {
  iframe: HTMLIFrameElement;
  cw: FakeContentWindow;
} {
  const cw: FakeContentWindow = { postMessage: vi.fn() };
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", {
    value: cw,
    writable: false,
  });
  return { iframe, cw };
}

function mkEnv(
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

describe("sandbox iframe attribute", () => {
  it("renders with allow-scripts only and no escape-enabling tokens", () => {
    const { container } = render(
      <PluginIframeHost
        pluginId="com.example.basic"
        slot="sidebar"
        bundleUrl="blob:test"
        grantedCapabilities={new Set()}
        handlers={{}}
      />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute("sandbox") ?? "";
    expect(sandbox).toBe("allow-scripts");
    // The presence of any of these tokens would defeat the null-origin
    // sandbox guarantee or open navigation/storage escape vectors.
    const forbidden = [
      "allow-same-origin",
      "allow-top-navigation",
      "allow-top-navigation-by-user-activation",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-modals",
      "allow-forms",
      "allow-storage-access-by-user-activation",
      "allow-presentation",
      "allow-pointer-lock",
      "allow-orientation-lock",
      "allow-downloads",
    ];
    for (const tok of forbidden) {
      expect(sandbox).not.toContain(tok);
    }
    cleanup();
  });
});

describe("bridge sandbox-escape regressions", () => {
  it("drops messages whose source is window.top, window.parent, or any other window", async () => {
    const { iframe, cw } = makeIframe();
    const onSecurityEvent = vi.fn();
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(["mission.read"]),
      iframe,
      handlers: { "mission.read": vi.fn(() => ({ leaked: true })) },
      onSecurityEvent,
    });
    // Synthesize a "spoofed parent" pretending to be a sibling window.
    const fakeParent = {
      postMessage: vi.fn(),
    } as unknown as WindowProxy;
    await bridge.handleEnvelope(
      mkEnv({ id: "spoof-1", method: "mission.read" }),
      fakeParent,
    );
    expect(cw.postMessage).not.toHaveBeenCalled();
    expect(onSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "origin_mismatch" }),
    );
    bridge.dispose();
  });

  it("ignores the envelope.capability field — required cap comes from method, not from the wire", async () => {
    // A malicious plugin could try to assert a fake capability in the
    // envelope. The bridge MUST ignore the wire field and resolve the
    // required capability from the method itself, then check the
    // granted set. This test pins that contract.
    const { iframe, cw } = makeIframe();
    const onSecurityEvent = vi.fn();
    const handler = vi.fn(() => ({ ok: true }));
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      // The granted set is EMPTY. The plugin holds nothing.
      grantedCapabilities: new Set(),
      iframe,
      handlers: { "command.send": handler },
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      mkEnv({
        id: "forge-1",
        method: "command.send",
        // Plugin lies: claims it already has the capability.
        capability: "command.send",
        args: { command: "MAV_CMD_NAV_LAND" },
      }),
      iframe.contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("permission_denied");
    bridge.dispose();
  });

  it("rejects envelopes with __proto__ injection or unknown extra fields without invoking handlers", async () => {
    const { iframe, cw } = makeIframe();
    const onSecurityEvent = vi.fn();
    const handler = vi.fn();
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: new Set(),
      iframe,
      handlers: { ping: handler },
      onSecurityEvent,
    });
    // Hostile envelope: wrong version + tries to pollute via __proto__.
    const hostile: unknown = {
      id: "evil-1",
      type: "request",
      method: "ping",
      capability: "",
      args: { __proto__: { polluted: true } },
      version: 99,
    };
    await bridge.handleEnvelope(
      hostile as PluginRpcEnvelope,
      iframe.contentWindow,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(cw.postMessage).not.toHaveBeenCalled();
    expect(onSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "schema_invalid" }),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    bridge.dispose();
  });

  it("does not invoke an unregistered host method even if the plugin pretends to hold its capability", async () => {
    const { iframe, cw } = makeIframe();
    const onSecurityEvent = vi.fn();
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      // Forge ALL the dangerous caps — the bridge should still gate on
      // method-name registry, not on the wire field.
      grantedCapabilities: new Set([
        "vehicle.command",
        "filesystem.write",
        "credentials.read",
        "host.eval",
      ]),
      iframe,
      handlers: {},
      onSecurityEvent,
    });
    await bridge.handleEnvelope(
      mkEnv({ id: "x-1", method: "host.eval", args: { code: "alert(1)" } }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("method_unknown");
    expect(onSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "method_unknown" }),
    );
    bridge.dispose();
  });

  it("returns bounded error envelopes that do not leak handler state or the granted set", async () => {
    const { iframe, cw } = makeIframe();
    // Grant the resolved capability so dispatch reaches the handler;
    // also stuff the granted set with other secrets to verify they
    // never escape through the error message.
    const granted = new Set([
      "telemetry.subscribe.mavlink.attitude",
      "secret.cap.alpha",
      "secret.cap.beta",
    ]);
    const bridge = createPluginBridge({
      pluginId: "com.example.basic",
      grantedCapabilities: granted,
      iframe,
      handlers: {
        "telemetry.subscribe": () => {
          throw new Error("boom");
        },
      },
      onSecurityEvent: vi.fn(),
    });
    await bridge.handleEnvelope(
      mkEnv({
        id: "leak-1",
        method: "telemetry.subscribe",
        args: { topic: "mavlink.attitude" },
      }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    const err = last.error as BridgeError | undefined;
    expect(err?.code).toBe("handler_error");
    // The error envelope must contain ONLY {code, message} — no other
    // fields can be enumerable, otherwise the host risks leaking state
    // via structured-clone of internal objects.
    expect(Object.keys(err ?? {}).sort()).toEqual(["code", "message"]);
    // Message itself must be the thrown error, not stringified state.
    expect(err?.message).toBe("boom");
    // Negative: no other granted-set capability name escapes through
    // the error envelope (message OR any other field).
    const wire = JSON.stringify(last);
    expect(wire).not.toContain("secret.cap.alpha");
    expect(wire).not.toContain("secret.cap.beta");
    bridge.dispose();
  });

  it("validateEnvelope rejects every shape that is not a v1 RPC envelope", () => {
    const cases: unknown[] = [
      null,
      undefined,
      0,
      "",
      "not an object",
      [],
      {},
      { id: "", type: "request", method: "ping", capability: "", version: 1 },
      { id: "x", type: "weird", method: "ping", capability: "", version: 1 },
      { id: "x", type: "request", method: "", capability: "", version: 1 },
      { id: "x", type: "request", method: "ping", capability: 1, version: 1 },
      { id: "x", type: "request", method: "ping", capability: "", version: 0 },
      { id: "x", type: "request", method: "ping", capability: "", version: 2 },
    ];
    for (const c of cases) {
      expect(validateEnvelope(c)).toBe(false);
    }
  });
});
