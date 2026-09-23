/**
 * Bridge-level integration tests for the 5-check token validation
 * pipeline. We mint signed tokens in-test and exercise each failure
 * mode independently.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { createPluginBridge, type BridgeError } from "@/lib/plugins/bridge";
import {
  importHmacKey,
  type TokenClaims,
} from "@/lib/plugins/capability-token-claims";
import type { PluginRpcEnvelope } from "@/lib/plugins/types";

// --------------------------------------------------------------------
// Helpers (mirror the agent's canonical claims encoding)
// --------------------------------------------------------------------

function urlsafeB64NoPad(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function canonicalBlob(claims: TokenClaims): Uint8Array {
  const sorted: (keyof TokenClaims)[] = [
    "agentId",
    "expiresAt",
    "grantedCapabilities",
    "iss",
    "operatorId",
    "pluginId",
  ];
  const obj: Record<string, unknown> = {};
  for (const k of sorted) obj[k] = claims[k];
  return new TextEncoder().encode(JSON.stringify(obj));
}

async function mintTokenFor(
  claims: TokenClaims,
  secret: Uint8Array,
): Promise<string> {
  const blob = canonicalBlob(claims);
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, blob as BufferSource),
  );
  return `${urlsafeB64NoPad(blob)}.${urlsafeB64NoPad(sig)}`;
}

interface FakeIframe extends HTMLIFrameElement {
  contentWindow: WindowProxy;
}

function makeIframe(): { iframe: FakeIframe; cw: { postMessage: ReturnType<typeof vi.fn> } } {
  const cw = { postMessage: vi.fn() };
  const iframe = document.createElement("iframe") as FakeIframe;
  Object.defineProperty(iframe, "contentWindow", { value: cw, writable: false });
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

// --------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------

const PLUGIN = "com.example.basic";
const AGENT = "drone-id-1";
const SECRET = new Uint8Array(32).fill(0x11);

function baseClaims(over: Partial<TokenClaims>): TokenClaims {
  return {
    pluginId: PLUGIN,
    agentId: AGENT,
    operatorId: "user-1",
    expiresAt: Date.now() + 60_000,
    grantedCapabilities: ["command.send"],
    iss: `agent:${AGENT}`,
    ...over,
  };
}

describe("bridge token validation", () => {
  let iframe: FakeIframe;
  let cw: { postMessage: ReturnType<typeof vi.fn> };
  let onSecurityEvent: (event: BridgeError & { method?: string }) => void;
  const secretResolver = async () => [await importHmacKey(SECRET)];

  beforeEach(() => {
    ({ iframe, cw } = makeIframe());
    onSecurityEvent = vi.fn() as unknown as typeof onSecurityEvent;
  });

  function build(opts?: {
    granted?: Set<string>;
    secretResolver?: typeof secretResolver;
  }) {
    return createPluginBridge({
      pluginId: PLUGIN,
      grantedCapabilities: opts?.granted ?? new Set(["command.send"]),
      iframe,
      handlers: { "command.send": vi.fn(async () => ({ sent: true })) },
      onSecurityEvent,
      tokenValidator: {
        expectedAgentId: AGENT,
        secretResolver: opts?.secretResolver ?? secretResolver,
      },
    });
  }

  it("check 1: rejects an envelope with no token", async () => {
    const bridge = build();
    await bridge.handleEnvelope(
      envelope({
        id: "r1",
        method: "command.send",
        capability: "command.send",
      }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("capability_denied");
    expect(last.error?.message).toMatch(/token_missing/);
    bridge.dispose();
  });

  it("check 2: rejects an expired token and fires onTokenExpired", async () => {
    const onTokenExpired = vi.fn();
    const bridge = createPluginBridge({
      pluginId: PLUGIN,
      grantedCapabilities: new Set(["command.send"]),
      iframe,
      handlers: { "command.send": vi.fn() },
      onSecurityEvent,
      tokenValidator: {
        expectedAgentId: AGENT,
        secretResolver,
        onTokenExpired,
      },
    });
    const token = await mintTokenFor(
      baseClaims({ expiresAt: Date.now() - 1000 }),
      SECRET,
    );
    // A plugin polling with the same stale token denies every call but asks
    // for one refresh; a different expired token asks again.
    for (const id of ["r1", "r2", "r3"]) {
      await bridge.handleEnvelope(
        envelope({ id, method: "command.send", capability: "command.send", token }),
        iframe.contentWindow,
      );
    }
    const last = cw.postMessage.mock.calls[2][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("capability_denied");
    expect(last.error?.message).toMatch(/token_expired/);
    expect(onTokenExpired).toHaveBeenCalledTimes(1);

    const other = await mintTokenFor(
      baseClaims({ expiresAt: Date.now() - 500 }),
      SECRET,
    );
    await bridge.handleEnvelope(
      envelope({ id: "r4", method: "command.send", capability: "command.send", token: other }),
      iframe.contentWindow,
    );
    expect(onTokenExpired).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  it("check 3: rejects a cross-plugin token", async () => {
    const bridge = build();
    const token = await mintTokenFor(
      baseClaims({ pluginId: "com.attacker.evil" }),
      SECRET,
    );
    await bridge.handleEnvelope(
      envelope({
        id: "r1",
        method: "command.send",
        capability: "command.send",
        token,
      }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("capability_denied");
    expect(last.error?.message).toMatch(/plugin_mismatch/);
    bridge.dispose();
  });

  it("check 4: rejects a cross-drone token (agent id mismatch)", async () => {
    const bridge = build();
    const token = await mintTokenFor(
      baseClaims({ iss: `agent:other-drone`, agentId: "other-drone" }),
      SECRET,
    );
    await bridge.handleEnvelope(
      envelope({
        id: "r1",
        method: "command.send",
        capability: "command.send",
        token,
      }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("capability_denied");
    expect(last.error?.message).toMatch(/agent_mismatch/);
    bridge.dispose();
  });

  it("check 5a: rejects when grantedCapabilities does not include required cap", async () => {
    const bridge = build();
    const token = await mintTokenFor(
      baseClaims({ grantedCapabilities: ["telemetry.subscribe.foo"] }),
      SECRET,
    );
    await bridge.handleEnvelope(
      envelope({
        id: "r1",
        method: "command.send",
        capability: "command.send",
        token,
      }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("capability_denied");
    expect(last.error?.message).toMatch(/command\.send/);
    bridge.dispose();
  });

  it("check 5b: rejects when signature does not verify", async () => {
    const wrong = new Uint8Array(32).fill(0xaa);
    const bridge = build();
    const token = await mintTokenFor(baseClaims({}), wrong);
    await bridge.handleEnvelope(
      envelope({
        id: "r1",
        method: "command.send",
        capability: "command.send",
        token,
      }),
      iframe.contentWindow,
    );
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error?.code).toBe("capability_denied");
    expect(last.error?.message).toMatch(/signature_invalid/);
    bridge.dispose();
  });

  it("passes a well-formed token through to the handler", async () => {
    const handler =
      vi.fn<
        (
          args: unknown,
          ctx: { claims: TokenClaims | null },
        ) => Promise<{ sent: true }>
      >(async () => ({ sent: true }));
    const bridge = createPluginBridge({
      pluginId: PLUGIN,
      grantedCapabilities: new Set(["command.send"]),
      iframe,
      handlers: { "command.send": handler },
      onSecurityEvent,
      tokenValidator: { expectedAgentId: AGENT, secretResolver },
    });
    const token = await mintTokenFor(baseClaims({}), SECRET);
    await bridge.handleEnvelope(
      envelope({
        id: "r1",
        method: "command.send",
        capability: "command.send",
        token,
      }),
      iframe.contentWindow,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][1];
    expect(ctx.claims?.pluginId).toBe(PLUGIN);
    expect(ctx.claims?.agentId).toBe(AGENT);
    const last = cw.postMessage.mock.calls[0][0] as PluginRpcEnvelope;
    expect(last.error).toBeUndefined();
    expect(last.args).toEqual({ sent: true });
    bridge.dispose();
  });
});
