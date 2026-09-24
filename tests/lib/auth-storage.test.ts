import { afterEach, describe, expect, it, vi } from "vitest";

// A real Storage-shaped backing so any write a store makes is observable.
vi.hoisted(() => {
  for (const name of ["localStorage", "sessionStorage"]) {
    const mem = new Map<string, string>();
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, String(v)),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
        key: (i: number) => [...mem.keys()][i] ?? null,
        get length() {
          return mem.size;
        },
      },
    });
  }
});

import { usePairingStore } from "@/stores/pairing-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

/**
 * The pairing store and the ambient agent connection hold an agent key in
 * memory only: nothing they do writes it to web storage, where every script
 * on the page could read it. (Paired LAN nodes keep their key in the
 * local-nodes store by design so they can reconnect offline; that store is
 * not covered here.)
 */

const SECRET = "agent-key-7f3c9e1d";

function webStorageText(): string {
  const dump = (s: Storage) =>
    Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i) ?? "")}`).join("\n");
  return `${dump(localStorage)}\n${dump(sessionStorage)}`;
}

afterEach(() => {
  usePairingStore.getState().clear();
  useAgentConnectionStore.getState().setApiKey(null);
});

describe("agent keys stay out of web storage", () => {
  it("pairing a drone, renaming and selecting it never persists its key", () => {
    const pairing = usePairingStore.getState();
    pairing.setPairedDrones([
      {
        _id: "d1",
        deviceId: "dev-1",
        name: "Alpha",
        apiKey: SECRET,
      } as Parameters<typeof pairing.setPairedDrones>[0][number],
    ]);
    pairing.updatePairedDroneName("d1", "Bravo");
    pairing.selectPairedDrone("d1");

    expect(usePairingStore.getState().pairedDrones[0]?.apiKey).toBe(SECRET);
    expect(webStorageText()).not.toContain(SECRET);
  });

  it("setting the ambient connection's key never persists it", () => {
    useAgentConnectionStore.getState().setApiKey(SECRET);

    expect(useAgentConnectionStore.getState().apiKey).toBe(SECRET);
    expect(webStorageText()).not.toContain(SECRET);
  });
});
