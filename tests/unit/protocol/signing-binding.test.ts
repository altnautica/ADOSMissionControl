import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A connected MAVLink session signs with whatever key the keystore holds for
 * the drone, and follows enrollment, removal and legacy-record cleanup.
 */

const storeById = vi.hoisted(() => new Map<symbol, Map<string, unknown>>());

vi.mock("idb-keyval", () => ({
  createStore: (_db: string, name: string) => {
    const token = Symbol(name);
    storeById.set(token, new Map());
    return token;
  },
  get: async (key: IDBValidKey, store: symbol) => storeById.get(store)?.get(String(key)),
  set: async (key: IDBValidKey, value: unknown, store: symbol) => {
    storeById.get(store)?.set(String(key), value);
  },
  del: async (key: IDBValidKey, store: symbol) => {
    storeById.get(store)?.delete(String(key));
  },
  keys: async (store: symbol) => Array.from(storeById.get(store)?.keys() ?? []),
}));

import { importAndStore, getRecord, getSigner, clear } from "@/lib/protocol/signing-keystore";
import { bindSigning } from "@/lib/protocol/signing-binding";
import { MAVLinkAdapter } from "@/lib/protocol/mavlink-adapter";
import type { MavlinkSigner } from "@/lib/protocol/mavlink-signer";
import { useSigningStore } from "@/stores/signing-store";

const DRONE = "drone-a";

describe("bindSigning", () => {
  let adapter: MAVLinkAdapter;
  let applied: (MavlinkSigner | null)[];

  beforeEach(() => {
    for (const s of storeById.values()) s.clear();
    useSigningStore.getState().clearAll();
    adapter = new MAVLinkAdapter();
    applied = [];
    vi.spyOn(adapter, "setSigner").mockImplementation((s) => {
      applied.push(s);
    });
  });

  it("signs with the stored key and stops when the key is removed", async () => {
    await importAndStore({ droneId: DRONE, userId: null, keyBytes: new Uint8Array(32).fill(9), linkId: 4 });
    const unbind = bindSigning(DRONE, adapter);
    await vi.waitFor(() => expect(applied.at(-1)?.linkId).toBe(4));

    await clear(DRONE);
    useSigningStore.getState().setBrowserKey(DRONE, null);
    await vi.waitFor(() => expect(applied.at(-1)).toBeNull());

    unbind();
  });

  it("starts signing once a key is enrolled while connected", async () => {
    const unbind = bindSigning(DRONE, adapter);
    await vi.waitFor(() => expect(applied).toEqual([null]));

    const rec = await importAndStore({ droneId: DRONE, userId: null, keyBytes: new Uint8Array(32).fill(3), linkId: 2 });
    useSigningStore.getState().setBrowserKey(DRONE, {
      keyId: rec.keyId,
      enrolledAt: rec.enrolledAt,
      enrollmentState: "enrolled",
    });
    await vi.waitFor(() => expect(applied.at(-1)?.keyId).toBe(rec.keyId));

    unbind();
    expect(applied.at(-1)).toBeNull();
  });
});

describe("signing keystore records", () => {
  beforeEach(() => {
    for (const s of storeById.values()) s.clear();
  });

  it("drops a record that holds no raw key bytes and reports no key", async () => {
    await importAndStore({ droneId: DRONE, userId: null, keyBytes: new Uint8Array(32).fill(1), linkId: 1 });
    // Rewrite the stored record into the old CryptoKey-only shape.
    for (const store of storeById.values()) {
      const rec = store.get(DRONE) as Record<string, unknown> | undefined;
      if (rec) {
        const { keyBytes: _drop, ...rest } = rec;
        store.set(DRONE, { ...rest, cryptoKey: {} });
      }
    }
    expect(await getSigner(DRONE)).toBeNull();
    expect(await getRecord(DRONE)).toBeNull();
  });

  it("stores a copy and zeroizes the caller's buffer", async () => {
    const keyBytes = new Uint8Array(32).fill(0x42);
    const rec = await importAndStore({ droneId: DRONE, userId: null, keyBytes, linkId: 1 });
    expect(Array.from(keyBytes).every((b) => b === 0)).toBe(true);
    expect(Array.from(rec.keyBytes).every((b) => b === 0x42)).toBe(true);
  });
});
