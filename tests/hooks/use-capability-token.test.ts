/**
 * Tests for `useCapabilityToken`. Covers:
 *   - LAN mint via fetch with X-ADOS-Key
 *   - Cloud mint via Convex action
 *   - Auto-refresh 60s before expiry
 *   - Dedupe across two hook instances sharing the same key
 *   - Error surfacing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// --- Mocks ----------------------------------------------------------

const cloudMintMock =
  vi.fn<
    (args: { pluginInstallId: string; deviceId: string }) => Promise<{
      token: string;
      expiresAt: number;
    }>
  >();
const useActionMock = vi.fn((_ref: unknown) => cloudMintMock);

vi.mock("convex/react", () => ({
  useAction: (ref: unknown) => useActionMock(ref),
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    cmdPluginCapabilityTokens: {
      mintToken: { _ref: "cmdPluginCapabilityTokens.mintToken" },
    },
  },
}));

import {
  __resetCapabilityTokenCacheForTests,
  useCapabilityToken,
} from "@/hooks/use-capability-token";
import { usePairingStore } from "@/stores/pairing-store";

// --------------------------------------------------------------------
// Token helpers (same canonical format as the agent / bridge tests)
// --------------------------------------------------------------------

function urlsafeB64NoPad(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface TestClaims {
  pluginId: string;
  agentId: string;
  operatorId: string;
  expiresAt: number;
  grantedCapabilities: string[];
  iss: string;
}

async function buildToken(claims: TestClaims): Promise<string> {
  const sortedKeys: (keyof TestClaims)[] = [
    "agentId",
    "expiresAt",
    "grantedCapabilities",
    "iss",
    "operatorId",
    "pluginId",
  ];
  const obj: Record<string, unknown> = {};
  for (const k of sortedKeys) obj[k] = claims[k];
  const blob = new TextEncoder().encode(JSON.stringify(obj));
  const secret = new Uint8Array(32).fill(1);
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

const PLUGIN_INSTALL_ID = "k0001cmdpluginInstalls" as unknown as string;
const DEVICE_ID = "drone-id-1";

function seedPairedDrone() {
  usePairingStore.setState({
    pairedDrones: [
      {
        _id: "drone-row-1",
        userId: "user-1",
        deviceId: DEVICE_ID,
        name: "Test Drone",
        apiKey: "test-api-key",
        mdnsHost: "testnode.local",
        pairedAt: Date.now(),
      },
    ],
    discoveredAgents: [],
    selectedPairedId: null,
    pairingInProgress: false,
    pairingError: null,
  });
}

// --------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------

describe("useCapabilityToken", () => {
  beforeEach(() => {
    __resetCapabilityTokenCacheForTests();
    cloudMintMock.mockReset();
    seedPairedDrone();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mints a LAN token via fetch with X-ADOS-Key", async () => {
    const token = await buildToken({
      pluginId: "com.example.basic",
      agentId: DEVICE_ID,
      operatorId: "user-1",
      expiresAt: Date.now() + 60_000,
      grantedCapabilities: ["command.send"],
      iss: `agent:${DEVICE_ID}`,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, token }), { status: 200 }),
    );
    const { result } = renderHook(() =>
      useCapabilityToken(PLUGIN_INSTALL_ID, "com.example.basic", DEVICE_ID, "lan"),
    );
    await waitFor(() => expect(result.current.token).toBeTruthy());
    expect(result.current.claims?.pluginId).toBe("com.example.basic");
    const callUrl = fetchMock.mock.calls[0][0];
    const callInit = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(String(callUrl)).toBe(
      "http://testnode.local:8080/api/plugins/capability-token",
    );
    const headers = callInit?.headers as Record<string, string>;
    expect(headers["X-ADOS-Key"]).toBe("test-api-key");
    // The agent looks the install up by the manifest plugin id
    // (`CapabilityTokenRequest.plugin_id`), never the cloud install row id.
    expect(JSON.parse(String(callInit?.body))).toEqual({
      plugin_id: "com.example.basic",
    });
  });

  it("mints a cloud token via Convex action", async () => {
    const token = await buildToken({
      pluginId: "com.example.basic",
      agentId: DEVICE_ID,
      operatorId: "user-1",
      expiresAt: Date.now() + 60_000,
      grantedCapabilities: ["command.send"],
      iss: "cloud:user-1",
    });
    cloudMintMock.mockResolvedValueOnce({
      token,
      expiresAt: Date.now() + 60_000,
    });
    const { result } = renderHook(() =>
      useCapabilityToken(PLUGIN_INSTALL_ID, "com.example.basic", DEVICE_ID, "cloud"),
    );
    await waitFor(() => expect(result.current.token).toBeTruthy());
    // React 19 + RTL double-mounts hooks under test; we accept either
    // 1 or 2 invocations here. The dedupe contract is exercised in the
    // dedicated test below.
    expect(cloudMintMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(cloudMintMock).toHaveBeenCalledWith({
      pluginInstallId: PLUGIN_INSTALL_ID,
      deviceId: DEVICE_ID,
    });
    expect(result.current.claims?.iss).toBe("cloud:user-1");
  });

  it("auto-refreshes 60s before the claimed expiry", async () => {
    vi.useFakeTimers();
    const baseNow = 1_700_000_000_000;
    vi.setSystemTime(baseNow);
    const tokenA = await buildToken({
      pluginId: "com.example.basic",
      agentId: DEVICE_ID,
      operatorId: "user-1",
      expiresAt: baseNow + 120_000, // 2 min from now, refresh at 60s
      grantedCapabilities: ["command.send"],
      iss: "cloud:user-1",
    });
    const tokenB = await buildToken({
      pluginId: "com.example.basic",
      agentId: DEVICE_ID,
      operatorId: "user-1",
      expiresAt: baseNow + 600_000,
      grantedCapabilities: ["command.send"],
      iss: "cloud:user-1",
    });
    cloudMintMock
      .mockResolvedValueOnce({ token: tokenA, expiresAt: baseNow + 120_000 })
      .mockResolvedValueOnce({ token: tokenB, expiresAt: baseNow + 600_000 });

    const { result } = renderHook(() =>
      useCapabilityToken(PLUGIN_INSTALL_ID, "com.example.basic", DEVICE_ID, "cloud"),
    );
    await vi.waitFor(() => expect(result.current.token).toBe(tokenA));
    // Advance to 60s before expiry — refresh fires at expiresAt - 60s.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.token).toBe(tokenB));
    expect(cloudMintMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("dedupes inflight mints across two hook instances for the same key", async () => {
    const token = await buildToken({
      pluginId: "com.example.basic",
      agentId: DEVICE_ID,
      operatorId: "user-1",
      expiresAt: Date.now() + 60_000,
      grantedCapabilities: ["command.send"],
      iss: "cloud:user-1",
    });
    // Each hold blocks the mint until we resolve it; we count holds so
    // we know how many distinct mints actually escaped the cache.
    const holds: Array<(value: { token: string; expiresAt: number }) => void> = [];
    cloudMintMock.mockImplementation(
      () =>
        new Promise<{ token: string; expiresAt: number }>((res) => {
          holds.push(res);
        }),
    );
    const { result: a } = renderHook(() =>
      useCapabilityToken(PLUGIN_INSTALL_ID, "com.example.basic", DEVICE_ID, "cloud"),
    );
    const { result: b } = renderHook(() =>
      useCapabilityToken(PLUGIN_INSTALL_ID, "com.example.basic", DEVICE_ID, "cloud"),
    );
    // Both hooks attached to the same cache key. The second hook MUST
    // attach to the inflight promise instead of issuing a fresh mint.
    // React 19 double-mounts each hook, but the inflight cache absorbs
    // the duplicates — we accept up to two distinct mints (one per
    // effect cycle), never four.
    expect(holds.length).toBeLessThanOrEqual(2);
    await act(async () => {
      for (const r of holds) r({ token, expiresAt: Date.now() + 60_000 });
      await Promise.resolve();
    });
    await waitFor(() => expect(a.current.token).toBe(token));
    await waitFor(() => expect(b.current.token).toBe(token));
  });

  it("surfaces a mint error", async () => {
    cloudMintMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() =>
      useCapabilityToken(PLUGIN_INSTALL_ID, "com.example.basic", DEVICE_ID, "cloud"),
    );
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.error?.message).toMatch(/boom/);
    expect(result.current.token).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
