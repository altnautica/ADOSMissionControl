/**
 * @license GPL-3.0-only
 *
 * The replay control shows the log the operator loaded last. A slower earlier
 * load, or one the operator cleared, must not land over it when its read
 * finally settles.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useSimReplayStore } from "../sim-replay-store";

/** A File whose bytes arrive only when the test releases them. */
function slowFile(name: string, bytes: Uint8Array): { file: File; release: () => void } {
  const { promise, resolve } = Promise.withResolvers<ArrayBuffer>();
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const file = new File([buffer], name);
  Object.defineProperty(file, "arrayBuffer", { value: () => promise });
  return { file, release: () => resolve(buffer) };
}

describe("sim replay load ordering", () => {
  beforeEach(() => {
    useSimReplayStore.getState().clear();
  });

  it("a load cleared before its bytes arrive leaves the store cleared", async () => {
    const { file, release } = slowFile("flight.csv", new Uint8Array([1, 2, 3]));
    const pending = useSimReplayStore.getState().loadFromFile(file);
    useSimReplayStore.getState().clear();

    release();
    await pending;

    const s = useSimReplayStore.getState();
    expect(s.error).toBeNull();
    expect(s.track).toBeNull();
    expect(s.loading).toBe(false);
  });

  it("an earlier, slower load does not replace the result of a later one", async () => {
    const slow = slowFile("first.csv", new Uint8Array([1]));
    const first = useSimReplayStore.getState().loadFromFile(slow.file);
    await useSimReplayStore.getState().loadFromFile(new File([new ArrayBuffer(1)], "second.txt"));
    const afterSecond = useSimReplayStore.getState().error;

    slow.release();
    await first;

    expect(afterSecond).toEqual({ code: "unsupported", detail: "txt" });
    expect(useSimReplayStore.getState().error).toEqual({ code: "unsupported", detail: "txt" });
  });
});
