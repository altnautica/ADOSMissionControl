/**
 * The generate-code flow only ever shows a code the cloud backend issued.
 * With no pre-generate mutation (no backend, or auth still settling) it
 * shows no code at all, and it generates once the mutation arrives.
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

import {
  usePairingFlow,
  type PairingRequestId,
} from "@/components/command/pairing/use-pairing-flow";

type Flow = Parameters<typeof usePairingFlow>[0];

describe("generate-code pairing", () => {
  it("shows no code without a backend mutation, then generates once it arrives", async () => {
    const base: Flow = {
      open: true,
      requiresSignIn: false,
      claimCode: null,
      preGenerate: null,
      watchClaim: null,
      initialCode: null,
      autoGenerate: true,
    };
    const { result, rerender } = renderHook((p: Flow) => usePairingFlow(p), { initialProps: base });

    // Flush the effects and any generation they started.
    await act(async () => {});
    expect(result.current.preGenCode).toBeNull();
    expect(result.current.state).toBe("setup");

    const preGenerate = vi.fn(async () => ({
      requestId: "req-1" as PairingRequestId,
      code: "XYZ789",
    }));
    rerender({ ...base, preGenerate });
    await waitFor(() => expect(result.current.state).toBe("waiting"));
    expect(result.current.preGenCode).toBe("XYZ789");
    expect(preGenerate).toHaveBeenCalledTimes(1);
  });
});
