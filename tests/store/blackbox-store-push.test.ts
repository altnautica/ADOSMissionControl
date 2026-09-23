/**
 * @module blackbox-store-push.test
 * @description Verifies the explicit cloud-push state machine on the Black Box
 * store: the push transitions, the reset on clear(), the explicit-only
 * invariant — no filter / selection / refresh path may trigger a push — and
 * that a read answered after its node's client was replaced is discarded.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlackBoxStore } from "@/stores/blackbox-store";
import type { LoggingRow, PushResult } from "@/lib/agent/agent-client/logging";
import type { AgentClient } from "@/lib/agent/client";

const okResult: PushResult = {
  pending: false,
  window_id: "win_99",
  sha256: "deadbeef",
  bytes: 2048,
  rows: 50,
  deduped: false,
  synced: true,
};

const pendingResult: PushResult = {
  pending: true,
  window_id: null,
  sha256: null,
  bytes: 0,
  rows: 0,
  deduped: false,
  synced: false,
};

/** Install a minimal fake agent client whose `logging` exposes the methods
 * the store calls. Every read is a no-op so explicit-only can be asserted
 * (a push call would still go through pushWindow). */
function installFakeClient(pushImpl: () => Promise<PushResult>) {
  const pushWindow = vi.fn(pushImpl);
  const noop = vi.fn(async () => ({
    data: [],
    page: { next_cursor: null, count: 0 },
    meta: { source: "logd", v: 1, ts: "", db_lag_ms: 0 },
  }));
  const logging = {
    pushWindow,
    sessions: noop,
    query: noop,
    aggregate: noop,
    healthz: vi.fn(async () => ({
      ok: true,
      db_open: true,
      writer_alive: true,
      integrity: true,
      source: "logd",
    })),
    stats: vi.fn(async () => null),
  };
  useBlackBoxStore.getState().attach({ logging } as unknown as AgentClient);
  return { pushWindow, logging };
}

describe("blackbox-store push", () => {
  beforeEach(() => {
    useBlackBoxStore.getState().clear();
  });

  afterEach(() => {
    useBlackBoxStore.getState().clear();
    vi.restoreAllMocks();
  });

  it("starts idle with no push result", () => {
    const s = useBlackBoxStore.getState();
    expect(s.pushState).toBe("idle");
    expect(s.lastPushResult).toBeNull();
    expect(s.pushError).toBeNull();
  });

  it("transitions idle -> done and records the ack on success", async () => {
    const { pushWindow } = installFakeClient(async () => okResult);
    const result = await useBlackBoxStore.getState().pushWindow();
    expect(result).toEqual(okResult);
    const s = useBlackBoxStore.getState();
    expect(s.pushState).toBe("done");
    expect(s.lastPushResult).toEqual(okResult);
    expect(s.pushError).toBeNull();
    // The store forwards the selected session, the only scope the push has.
    expect(pushWindow).toHaveBeenCalledWith({ session: undefined });
  });

  it("records a pending push as pending, not done", async () => {
    installFakeClient(async () => pendingResult);
    await useBlackBoxStore.getState().pushWindow();
    const s = useBlackBoxStore.getState();
    expect(s.pushState).toBe("pending");
    expect(s.lastPushResult).toEqual(pendingResult);
  });

  it("transitions to error and records the message on failure", async () => {
    installFakeClient(async () => {
      throw new Error("push failed 409");
    });
    const result = await useBlackBoxStore.getState().pushWindow();
    expect(result).toBeNull();
    const s = useBlackBoxStore.getState();
    expect(s.pushState).toBe("error");
    expect(s.pushError).toBe("push failed 409");
  });

  it("errors when no logging client is attached", async () => {
    useBlackBoxStore.getState().attach(null);
    const result = await useBlackBoxStore.getState().pushWindow();
    expect(result).toBeNull();
    expect(useBlackBoxStore.getState().pushState).toBe("error");
  });

  it("resets push state on clear()", async () => {
    installFakeClient(async () => okResult);
    await useBlackBoxStore.getState().pushWindow();
    expect(useBlackBoxStore.getState().pushState).toBe("done");
    useBlackBoxStore.getState().clear();
    const s = useBlackBoxStore.getState();
    expect(s.pushState).toBe("idle");
    expect(s.lastPushResult).toBeNull();
    expect(s.pushError).toBeNull();
  });

  it("is explicit-only: setFilters, setSelectedSession, and refresh never push", async () => {
    const { pushWindow } = installFakeClient(async () => okResult);
    useBlackBoxStore.getState().setFilters({ level: "error" });
    useBlackBoxStore.getState().setSelectedSession("3");
    await useBlackBoxStore.getState().refresh();
    expect(pushWindow).not.toHaveBeenCalled();
  });

  it("discards a read that lands after the node's client was replaced", async () => {
    const { logging } = installFakeClient(async () => okResult);
    const { promise, resolve } = Promise.withResolvers<unknown>();
    logging.query.mockImplementationOnce(() => promise as never);
    const pending = useBlackBoxStore.getState().fetchRows();

    installFakeClient(async () => okResult);
    await Promise.resolve();
    resolve({
      data: [{ id: 1, message: "node A row" } as unknown as LoggingRow],
      page: { next_cursor: null, count: 1 },
      meta: { source: "logd", v: 1, ts: "", db_lag_ms: 0 },
    });
    await pending;
    expect(useBlackBoxStore.getState().rows).toEqual([]);
  });
});
