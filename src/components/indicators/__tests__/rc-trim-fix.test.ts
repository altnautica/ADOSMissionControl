import { describe, expect, it, vi } from "vitest";
import { applyRcTrims } from "../rc-trim-fix";
import type { CommandResult } from "@/lib/protocol/types/core";

const NOW = 1_000_000;

function result(success: boolean, message = ""): CommandResult {
  return { success, resultCode: success ? 0 : 4, message };
}

function rc(timestamp: number, channels: number[]) {
  return { timestamp, channels, rssi: 200 };
}

describe("applyRcTrims", () => {
  it("reports a write the flight controller did not confirm as failed", async () => {
    const setParameter = vi.fn(async () => result(false, "timed out"));
    const run = await applyRcTrims({ setParameter }, [2], rc(NOW - 100, [1500, 1504]), NOW);
    expect(run).toEqual({
      kind: "done",
      outcomes: [{ channel: 2, value: 1504, ok: false, reason: "timed out" }],
    });
  });

  it("marks only confirmed channels and reports channels with no reading", async () => {
    const setParameter = vi.fn(async (name: string) => result(name !== "RC3_TRIM", "value mismatch"));
    const run = await applyRcTrims({ setParameter }, [1, 3, 9], rc(NOW - 100, [1502, 1500, 1498]), NOW);
    if (run.kind !== "done") throw new Error("expected a completed run");
    expect(run.outcomes.map((o) => [o.channel, o.ok])).toEqual([
      [1, true],
      [3, false],
      [9, false],
    ]);
    expect(setParameter).toHaveBeenCalledTimes(2);
  });

  it("refuses to write trims from a stale RC reading", async () => {
    const setParameter = vi.fn(async () => result(true));
    const run = await applyRcTrims({ setParameter }, [1], rc(NOW - 60_000, [1502]), NOW);
    expect(run).toEqual({ kind: "stale" });
    expect(setParameter).not.toHaveBeenCalled();
  });

  it("turns a thrown write into a failed outcome", async () => {
    const setParameter = vi.fn(async () => {
      throw new Error("link down");
    });
    const run = await applyRcTrims({ setParameter }, [1], rc(NOW, [1502]), NOW);
    if (run.kind !== "done") throw new Error("expected a completed run");
    expect(run.outcomes[0]).toMatchObject({ ok: false, reason: "link down" });
  });
});
