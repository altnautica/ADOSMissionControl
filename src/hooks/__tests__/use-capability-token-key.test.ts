/**
 * @license GPL-3.0-only
 *
 * A capability token authorises one plugin on one drone. When the hook's key
 * moves to another drone, the previous drone's token must disappear at once,
 * and a mint for it that is still in flight must never land as this key's
 * token.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const cloudMint = vi.fn<(args: { pluginInstallId: string; deviceId: string }) => Promise<{
  token: string;
  expiresAt: number;
}>>();

vi.mock("convex/react", () => ({ useAction: () => cloudMint }));

import {
  __resetCapabilityTokenCacheForTests,
  useCapabilityToken,
} from "../use-capability-token";

function urlsafe(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function tokenFor(agentId: string): string {
  const claims = {
    agentId,
    expiresAt: Date.now() + 600_000,
    grantedCapabilities: ["command.send"],
    iss: "cloud:user-1",
    operatorId: "user-1",
    pluginId: "com.example.basic",
  };
  const blob = new TextEncoder().encode(JSON.stringify(claims));
  return `${urlsafe(blob)}.${urlsafe(new Uint8Array(32).fill(1))}`;
}

beforeEach(() => {
  __resetCapabilityTokenCacheForTests();
  cloudMint.mockReset();
});

describe("useCapabilityToken across a key change", () => {
  it("never shows a token minted for the previous drone", async () => {
    const mintA = Promise.withResolvers<{ token: string; expiresAt: number }>();
    const mintB = Promise.withResolvers<{ token: string; expiresAt: number }>();
    cloudMint.mockImplementation(({ deviceId }) =>
      deviceId === "drone-a" ? mintA.promise : mintB.promise,
    );

    const { result, rerender } = renderHook(
      ({ deviceId }: { deviceId: string }) =>
        useCapabilityToken("install-1", "com.example.basic", deviceId, "cloud"),
      { initialProps: { deviceId: "drone-a" } },
    );

    rerender({ deviceId: "drone-b" });
    await act(async () => {
      mintB.resolve({ token: tokenFor("drone-b"), expiresAt: Date.now() + 600_000 });
    });
    expect(result.current.claims?.agentId).toBe("drone-b");

    await act(async () => {
      mintA.resolve({ token: tokenFor("drone-a"), expiresAt: Date.now() + 600_000 });
    });
    expect(result.current.claims?.agentId).toBe("drone-b");
  });

  it("drops the previous drone's token while the new one is minting", async () => {
    cloudMint.mockImplementation(async ({ deviceId }) =>
      deviceId === "drone-a"
        ? { token: tokenFor("drone-a"), expiresAt: Date.now() + 600_000 }
        : Promise.withResolvers<{ token: string; expiresAt: number }>().promise,
    );
    const { result, rerender } = renderHook(
      ({ deviceId }: { deviceId: string }) =>
        useCapabilityToken("install-1", "com.example.basic", deviceId, "cloud"),
      { initialProps: { deviceId: "drone-a" } },
    );
    await act(async () => {});
    expect(result.current.claims?.agentId).toBe("drone-a");

    rerender({ deviceId: "drone-b" });

    expect(result.current.token).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});
