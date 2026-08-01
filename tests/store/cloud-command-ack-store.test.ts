import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useCloudCommandAckStore } from "@/stores/cloud-command-ack-store";

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
    s.watch({ commandId: "c1", deviceId: "d1" });
    // Advance past the 5-minute TTL: a lost command that never resolved must
    // not be carried forward into the next watch.
    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
    s.watch({ commandId: "c2", deviceId: "d1" });

    const pending = useCloudCommandAckStore.getState().pending;
    expect(pending.map((c) => c.commandId)).toEqual(["c2"]);
  });

  it("keeps fresh entries and stays idempotent per commandId", () => {
    const s = useCloudCommandAckStore.getState();
    s.watch({ commandId: "a", deviceId: "d" });
    s.watch({ commandId: "a", deviceId: "d" }); // duplicate is a no-op
    s.watch({ commandId: "b", deviceId: "d" });

    expect(useCloudCommandAckStore.getState().pending.map((c) => c.commandId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("resolve removes a command once its status is terminal", () => {
    const s = useCloudCommandAckStore.getState();
    s.watch({ commandId: "x", deviceId: "d" });
    s.watch({ commandId: "y", deviceId: "d" });
    s.resolve("x");

    expect(useCloudCommandAckStore.getState().pending.map((c) => c.commandId)).toEqual(["y"]);
  });
});
