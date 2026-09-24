/**
 * `records.*` bind the plugin id from the mount, never from the call, and
 * answer typed refusals the SDK can reject with.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ConvexError } from "convex/values";

import type { BridgeHandlerContext } from "@/lib/plugins/bridge";
import { useAuthStore } from "@/stores/auth-store";
import { buildRecordsHandlers, type PluginRecordsBackend } from "../records";

const ctx = {} as BridgeHandlerContext;

type BackendMock = { [K in keyof PluginRecordsBackend]: Mock<PluginRecordsBackend[K]> };

function backend(): BackendMock {
  return {
    list: vi.fn<PluginRecordsBackend["list"]>(async () => []),
    get: vi.fn<PluginRecordsBackend["get"]>(async () => null),
    put: vi.fn<PluginRecordsBackend["put"]>(async () => null),
    remove: vi.fn<PluginRecordsBackend["remove"]>(async () => null),
  };
}

describe("records handlers", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: true }));
  afterEach(() => useAuthStore.setState({ isAuthenticated: false }));

  it("binds the mounted plugin id and ignores one smuggled in the args", async () => {
    const store = backend();
    const h = buildRecordsHandlers("com.example.mine", store);
    const smuggled = { pluginId: "com.example.victim" };

    await h["records.put"]({ ...smuggled, collection: "jobs", key: "k", data: { a: 1 } }, ctx);
    await h["records.list"]({ ...smuggled, collection: "jobs", limit: 10 }, ctx);
    await h["records.get"]({ ...smuggled, collection: "jobs", key: "k" }, ctx);
    await h["records.remove"]({ ...smuggled, collection: "jobs", key: "k" }, ctx);

    for (const call of [store.put, store.list, store.get, store.remove]) {
      expect(call.mock.calls[0][0]).toMatchObject({ pluginId: "com.example.mine" });
    }
  });

  it("answers unavailable when signed out or with no cloud client", async () => {
    const store = backend();
    expect(
      await buildRecordsHandlers("com.example.mine")["records.list"]({ collection: "jobs" }, ctx),
    ).toEqual({ ok: false, error: "unavailable" });
    useAuthStore.setState({ isAuthenticated: false });
    expect(
      await buildRecordsHandlers("com.example.mine", store)["records.list"]({ collection: "jobs" }, ctx),
    ).toEqual({ ok: false, error: "unavailable" });
    expect(store.list).not.toHaveBeenCalled();
  });

  it("refuses malformed args before any cloud call", async () => {
    const store = backend();
    const h = buildRecordsHandlers("com.example.mine", store);
    expect(await h["records.put"]({ collection: "jobs", key: "k" }, ctx)).toEqual({
      ok: false,
      error: "invalid_args",
    });
    expect(await h["records.list"]({ collection: "jobs", deviceId: 7 }, ctx)).toEqual({
      ok: false,
      error: "invalid_args",
    });
    expect(store.put).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();
  });

  it("maps a server refusal to its code and anything else to failed", async () => {
    const store = backend();
    store.put.mockRejectedValueOnce(new ConvexError({ code: "limit_reached", message: "full" }));
    store.put.mockRejectedValueOnce(new Error("network down"));
    const h = buildRecordsHandlers("com.example.mine", store);
    const args = { collection: "jobs", key: "k", data: 1 };
    expect(await h["records.put"](args, ctx)).toEqual({ ok: false, error: "limit_reached" });
    expect(await h["records.put"](args, ctx)).toEqual({ ok: false, error: "failed" });
  });
});
