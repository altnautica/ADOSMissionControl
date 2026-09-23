/**
 * The pairing flow state machine: a generated code succeeds only for the
 * device that registered against that exact code (never for whichever drone
 * the fleet mirror happens to deliver late), the success card and the
 * post-pair handoff carry only the address the agent reported, the code
 * expires on schedule, one open mints one code, and a build with no cloud
 * backend never pretends to pair.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  type ClaimCodeMutation,
  type ClaimWatch,
  type PairingRequestId,
} from "@/components/command/pairing/use-pairing-flow";
import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";

type Flow = Parameters<typeof usePairingFlow>[0];

const REQUEST_ID = "req-1" as PairingRequestId;

function drone(overrides: Partial<PairedDrone>): PairedDrone {
  return {
    _id: `row-${overrides.deviceId ?? "x"}`,
    userId: "user-1",
    deviceId: "x",
    name: "Drone",
    apiKey: "key",
    pairedAt: 1,
    ...overrides,
  };
}

/** A controllable claim watch: `claim(deviceId)` plays the backend reporting
 *  that an agent registered against the watched request. */
function fakeWatch() {
  let listener: ((deviceId: string) => void) | null = null;
  const watched: PairingRequestId[] = [];
  const watch: ClaimWatch = (requestId, onClaimed) => {
    watched.push(requestId);
    listener = onClaimed;
    return () => {
      listener = null;
    };
  };
  return {
    watch,
    watched,
    claim: (deviceId: string) => act(() => listener?.(deviceId)),
  };
}

function generateFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    open: true,
    requiresSignIn: false,
    claimCode: null,
    preGenerate: vi.fn(async () => ({ requestId: REQUEST_ID, code: "XYZ789" })),
    watchClaim: null,
    initialCode: null,
    autoGenerate: true,
    ...overrides,
  };
}

beforeEach(() => {
  usePairingStore.setState({ pairedDrones: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("zero-touch success is tied to the generated code", () => {
  it("ignores drones the fleet mirror delivers after open and succeeds only for the claimed device", async () => {
    const watch = fakeWatch();
    const onPaired = vi.fn();
    const { result } = renderHook((p: Flow) => usePairingFlow(p), {
      initialProps: generateFlow({ watchClaim: watch.watch, onPaired }),
    });
    await waitFor(() => expect(result.current.state).toBe("waiting"));
    expect(watch.watched).toEqual([REQUEST_ID]);

    // The fleet query resolves after the dialog opened: an existing drone
    // lands in the mirror. It did not claim this code.
    act(() => {
      usePairingStore.setState({
        pairedDrones: [drone({ deviceId: "old-drone", pairedAt: 999, mdnsHost: "old.local" })],
      });
    });
    await act(async () => {});
    expect(result.current.state).toBe("waiting");

    // The backend reports the claim before the new row reaches the mirror.
    watch.claim("new-drone");
    await act(async () => {});
    expect(result.current.state).toBe("waiting");

    act(() => {
      usePairingStore.setState({
        pairedDrones: [
          drone({ deviceId: "old-drone", pairedAt: 999, mdnsHost: "old.local" }),
          drone({ deviceId: "new-drone", name: "New", apiKey: "new-key", pairedAt: 5 }),
        ],
      });
    });
    await waitFor(() => expect(result.current.state).toBe("success"));
    expect(result.current.pairedInfo?.deviceId).toBe("new-drone");
  });

  it("hands off a claimed device that reported no address, with no invented host", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const watch = fakeWatch();
    const onPaired = vi.fn();
    usePairingStore.setState({
      pairedDrones: [drone({ deviceId: "bare", apiKey: "bare-key" })],
    });
    const { result } = renderHook((p: Flow) => usePairingFlow(p), {
      initialProps: generateFlow({ watchClaim: watch.watch, onPaired }),
    });
    await waitFor(() => expect(result.current.state).toBe("waiting"));

    watch.claim("bare");
    await waitFor(() => expect(result.current.state).toBe("success"));
    expect(result.current.pairedInfo?.host).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(onPaired).toHaveBeenCalledWith("bare", "bare-key", "");
  });
});

describe("claim result", () => {
  it("shows the reported LAN address when the agent has no mDNS name", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const claimCode = vi.fn(async () => ({
      error: null,
      deviceId: "dev-9",
      name: "Bench",
      apiKey: "k9",
      localIp: "192.168.1.50",
    })) as ClaimCodeMutation;
    const onPaired = vi.fn();
    const { result } = renderHook((p: Flow) => usePairingFlow(p), {
      initialProps: generateFlow({
        claimCode,
        preGenerate: null,
        initialCode: "ABC123",
        autoGenerate: false,
        onPaired,
      }),
    });
    await waitFor(() => expect(result.current.state).toBe("success"));
    expect(result.current.pairedInfo).toEqual({
      deviceId: "dev-9",
      name: "Bench",
      apiKey: "k9",
      host: "192.168.1.50",
    });
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(onPaired).toHaveBeenCalledWith("dev-9", "k9", "http://192.168.1.50:8080");
  });
});

describe("generated code lifecycle", () => {
  it("expires an unclaimed code after its lifetime", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook((p: Flow) => usePairingFlow(p), {
      initialProps: generateFlow({ watchClaim: fakeWatch().watch }),
    });
    await waitFor(() => expect(result.current.state).toBe("waiting"));

    await act(async () => {
      vi.advanceTimersByTime(14 * 60 * 1000);
    });
    expect(result.current.state).toBe("waiting");

    await act(async () => {
      vi.advanceTimersByTime(61 * 1000);
    });
    expect(result.current.state).toBe("expired");
    expect(result.current.secondsLeft).toBe(0);
  });

  it("mints one code while a mint is still in flight", async () => {
    const pending = Promise.withResolvers<{ requestId: PairingRequestId; code: string }>();
    const preGenerate = vi.fn(() => pending.promise);
    const { result } = renderHook((p: Flow) => usePairingFlow(p), {
      initialProps: generateFlow({ preGenerate }),
    });
    await act(async () => {});
    expect(preGenerate).toHaveBeenCalledTimes(1);

    // A second request (retry press, parent effect) while the first is
    // outstanding must not insert another pairing request.
    await act(async () => {
      void result.current.generateCode();
    });
    expect(preGenerate).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ requestId: REQUEST_ID, code: "XYZ789" });
    });
    expect(result.current.preGenCode).toBe("XYZ789");
  });
});

describe("no cloud backend", () => {
  it("shows no code and refuses a claim instead of pairing", async () => {
    const { result } = renderHook((p: Flow) => usePairingFlow(p), {
      initialProps: generateFlow({ preGenerate: null, claimCode: null }),
    });
    await act(async () => {});
    expect(result.current.state).toBe("setup");
    expect(result.current.preGenCode).toBeNull();

    await act(async () => {
      await result.current.claimDiscovered({ pairingCode: "ABC123" });
    });
    expect(result.current.state).toBe("error");
    expect(result.current.pairedInfo).toBeNull();
  });
});
