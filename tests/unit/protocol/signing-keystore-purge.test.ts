import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * User-switch purge test.
 *
 * We mock idb-keyval with an in-memory Map so the test stays hermetic and
 * does not require a real IndexedDB runtime. The keystore module only
 * touches storage through idb-keyval's get/set/del/keys functions.
 */

type StoreMap = Map<string, unknown>;
const storeById = new Map<symbol, StoreMap>();

vi.mock("idb-keyval", () => {
  return {
    createStore: (_db: string, name: string) => {
      const token = Symbol(name);
      storeById.set(token, new Map());
      return token;
    },
    get: async (key: IDBValidKey, store: symbol) => {
      const s = storeById.get(store);
      return s?.get(String(key));
    },
    set: async (key: IDBValidKey, value: unknown, store: symbol) => {
      const s = storeById.get(store);
      s?.set(String(key), value);
    },
    del: async (key: IDBValidKey, store: symbol) => {
      const s = storeById.get(store);
      s?.delete(String(key));
    },
    keys: async (store: symbol) => {
      const s = storeById.get(store);
      return Array.from(s?.keys() ?? []);
    },
  };
});

import {
  importAndStore,
  listDroneIds,
  purgeForUser,
  clear,
} from "@/lib/protocol/signing-keystore";

describe("signing keystore purgeForUser", () => {
  beforeEach(async () => {
    // Wipe the mock map between tests.
    for (const s of storeById.values()) s.clear();
  });

  async function enroll(droneId: string, userId: string | null): Promise<void> {
    const keyBytes = new Uint8Array(32);
    keyBytes[0] = droneId.charCodeAt(0);
    await importAndStore({ droneId, userId, keyBytes, linkId: 1 });
  }

  it("removes records owned by a different user on sign-in as a new user", async () => {
    await enroll("drone-alpha", "user-A");
    await enroll("drone-bravo", "user-A");
    await enroll("drone-charlie", "user-B");

    expect((await listDroneIds()).sort()).toEqual([
      "drone-alpha",
      "drone-bravo",
      "drone-charlie",
    ]);

    const deleted = await purgeForUser("user-B");
    expect(deleted).toBe(2);
    expect(await listDroneIds()).toEqual(["drone-charlie"]);
  });

  it("preserves anonymous records on sign-out", async () => {
    await enroll("drone-alpha", "user-A");
    await enroll("drone-anon", null);

    const deleted = await purgeForUser(null);
    expect(deleted).toBe(1);

    const ids = await listDroneIds();
    expect(ids).toEqual(["drone-anon"]);
  });

  it("no-op when every record belongs to the current user", async () => {
    await enroll("drone-alpha", "user-A");
    await enroll("drone-bravo", "user-A");

    const deleted = await purgeForUser("user-A");
    expect(deleted).toBe(0);
    expect((await listDroneIds()).sort()).toEqual(["drone-alpha", "drone-bravo"]);
  });

  it("clear() deletes a single record", async () => {
    await enroll("drone-alpha", "user-A");
    await enroll("drone-bravo", "user-A");

    await clear("drone-alpha");
    expect((await listDroneIds())).toEqual(["drone-bravo"]);
  });
});
