/**
 * A /pair?code= deep link claims its code once the sign-in has settled, never
 * before (claiming during the auth load failed with "Convex not available"
 * and nothing ever retried), claims it once, and Retry claims the same code
 * again rather than generating a new one.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
});

import { usePairingFlow } from "@/components/command/pairing/use-pairing-flow";

type Flow = Parameters<typeof usePairingFlow>[0];

describe("deep-link pairing", () => {
  it("claims the code once sign-in settles, once, and Retry re-claims the same code", async () => {
    const claimCode = vi.fn(async () => ({ error: "invalid_pairing_code" }));
    const base: Flow = {
      open: true,
      requiresSignIn: false,
      claimCode: null,
      preGenerate: null,
      initialCode: "ABC123",
      autoGenerate: false,
    };
    // Auth still loading: no claim mutation yet.
    const { result, rerender } = renderHook((p: Flow) => usePairingFlow(p), { initialProps: base });
    expect(result.current.state).not.toBe("error");

    // Signed in: the claim runs.
    const signedIn = { ...base, claimCode: claimCode as unknown as Flow["claimCode"] };
    rerender(signedIn);
    await waitFor(() => expect(claimCode).toHaveBeenCalledTimes(1));
    expect(claimCode).toHaveBeenCalledWith({ code: "ABC123" });

    // Re-renders do not claim again.
    rerender({ ...signedIn });
    rerender({ ...signedIn });
    expect(claimCode).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(result.current.state).toBe("error"));
    act(() => result.current.retryDeepLinkClaim());
    await waitFor(() => expect(claimCode).toHaveBeenCalledTimes(2));
    expect(claimCode).toHaveBeenLastCalledWith({ code: "ABC123" });
  });
});
