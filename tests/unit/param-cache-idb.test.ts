/**
 * The offline panel-param cache belongs to the vehicle the values were read
 * from: another drone opening the same panel while disconnected gets nothing,
 * never the first drone's gains.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => {
    store.set(k, v);
  },
}));

import { cachePanelToIDB, getCachedPanelFromIDB } from "@/lib/param-cache-idb";

describe("param cache is keyed by drone and panel", () => {
  it("returns a drone's cached panel only for that drone", async () => {
    await cachePanelToIDB("drone-a", "pid", new Map([["ATC_RAT_RLL_P", 0.135]]));

    expect((await getCachedPanelFromIDB("drone-a", "pid"))?.params).toEqual({
      ATC_RAT_RLL_P: 0.135,
    });
    expect(await getCachedPanelFromIDB("drone-b", "pid")).toBeNull();
  });
});
