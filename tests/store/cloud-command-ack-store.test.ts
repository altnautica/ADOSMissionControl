import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  expiredBeforeDelivery,
  useCloudCommandAckStore,
  type OutstandingCloudCommand,
} from "@/stores/cloud-command-ack-store";

describe("expiredBeforeDelivery", () => {
  const cmd: OutstandingCloudCommand = {
    commandId: "c",
    deviceId: "d",
    ttlMs: 10_000,
    queuedAt: 1_000_000,
  };
  const closed = cmd.queuedAt + cmd.ttlMs + 2_000;

  it("reports a command the node never took once its window closed", () => {
    expect(expiredBeforeDelivery(cmd, { status: "pending" }, closed)).toBe(true);
  });

  it("does not call it early, before the window and its grace have passed", () => {
    expect(expiredBeforeDelivery(cmd, { status: "pending" }, closed - 1)).toBe(false);
  });

  it("keeps waiting on a command the node took in time", () => {
    expect(
      expiredBeforeDelivery(cmd, { status: "pending", deliveredAt: cmd.queuedAt + 3_000 }, closed),
    ).toBe(false);
  });

  it("leaves a terminal row to its own verdict", () => {
    expect(expiredBeforeDelivery(cmd, { status: "completed" }, closed)).toBe(false);
    expect(expiredBeforeDelivery(cmd, undefined, closed)).toBe(false);
  });
});

describe("cloud-command-ack-store pending TTL sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    useCloudCommandAckStore.setState({ pending: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sweeps entries older than 5 minutes on the next watch", () => {
    const s = useCloudCommandAckStore.getState();
    s.watch({ commandId: "c1", deviceId: "d1", ttlMs: 10_000 });
    // Advance past the 5-minute TTL: a lost command that never resolved must
    // not be carried forward into the next watch.
    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
    s.watch({ commandId: "c2", deviceId: "d1", ttlMs: 10_000 });

    const pending = useCloudCommandAckStore.getState().pending;
    expect(pending.map((c) => c.commandId)).toEqual(["c2"]);
  });

  it("keeps fresh entries and stays idempotent per commandId", () => {
    const s = useCloudCommandAckStore.getState();
    s.watch({ commandId: "a", deviceId: "d", ttlMs: 10_000 });
    s.watch({ commandId: "a", deviceId: "d", ttlMs: 10_000 }); // duplicate is a no-op
    s.watch({ commandId: "b", deviceId: "d", ttlMs: 10_000 });

    expect(useCloudCommandAckStore.getState().pending.map((c) => c.commandId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("resolve removes a command once its status is terminal", () => {
    const s = useCloudCommandAckStore.getState();
    s.watch({ commandId: "x", deviceId: "d", ttlMs: 10_000 });
    s.watch({ commandId: "y", deviceId: "d", ttlMs: 10_000 });
    s.resolve("x");

    expect(useCloudCommandAckStore.getState().pending.map((c) => c.commandId)).toEqual(["y"]);
  });
});
