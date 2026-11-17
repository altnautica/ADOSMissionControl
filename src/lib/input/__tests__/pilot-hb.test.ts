/**
 * @license GPL-3.0-only
 *
 * The pilot stream's `hb` comes from a dedicated Worker, so a hidden tab's
 * page-timer throttling cannot fake a silence. An observer tab's Worker keeps
 * its 1 s `hb` with the main thread idle. A tab that holds the stick session
 * sends `hb` only while its main thread has ticked within 2 s, so a stalled
 * operator tab goes silent and the pilot's link-loss action follows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HbFromWorker, HbToWorker, HbWorkerScope } from "../pilot-hb-loop";

interface FakeScope extends HbWorkerScope {
  /** Fake-clock times of every `hb` the Worker posted. */
  beats: number[];
  send: (msg: HbToWorker) => void;
}

function fakeScope(): FakeScope {
  const scope: FakeScope = {
    beats: [],
    onmessage: null,
    postMessage: (msg: HbFromWorker) => {
      if (msg.t === "hb") scope.beats.push(Date.now());
    },
    send: (msg) => scope.onmessage?.({ data: msg }),
  };
  return scope;
}

/** Load the Worker entry with `scope` as its global, as the browser runs it.
 *  A fresh dynamic import per test: the entry starts its loop at load time,
 *  on whatever `self` is then, so a static import cannot do it. */
async function startWorker(scope: FakeScope): Promise<void> {
  vi.resetModules();
  vi.stubGlobal("self", scope);
  await import("../pilot-hb-worker");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pilot hb Worker", () => {
  it("an observer keeps a 1 s hb while the main thread posts nothing", async () => {
    const scope = fakeScope();
    await startWorker(scope);
    vi.advanceTimersByTime(10_000);
    expect(scope.beats).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000]);
    scope.send({ t: "stop" });
    vi.advanceTimersByTime(5000);
    expect(scope.beats).toHaveLength(10);
  });

  it("a session-holding tab whose main thread stops ticking stops its hb within 2-3 s", async () => {
    const scope = fakeScope();
    await startWorker(scope);
    scope.send({ t: "holder", holder: true });
    // The main thread ticks every 500 ms for 5 s, then stalls.
    scope.send({ t: "tick" });
    for (let t = 500; t <= 5000; t += 500) {
      vi.advanceTimersByTime(500);
      scope.send({ t: "tick" });
    }
    const stalledAt = Date.now();
    expect(scope.beats).toEqual([1000, 2000, 3000, 4000, 5000]);
    vi.advanceTimersByTime(10_000);
    const after = scope.beats.filter((t) => t > stalledAt);
    expect(after.every((t) => t - stalledAt <= 3000)).toBe(true);
    expect(after.at(-1)! - stalledAt).toBeGreaterThanOrEqual(2000);
    // A tick again (the tab came back) resumes the hb at once.
    scope.send({ t: "tick" });
    vi.advanceTimersByTime(1000);
    expect(scope.beats.at(-1)).toBe(Date.now());
  });

  it("a holder that has never ticked sends nothing; handing the session on restores the plain hb", async () => {
    const scope = fakeScope();
    await startWorker(scope);
    scope.send({ t: "holder", holder: true });
    vi.advanceTimersByTime(5000);
    expect(scope.beats).toEqual([]);
    scope.send({ t: "holder", holder: false });
    vi.advanceTimersByTime(2000);
    expect(scope.beats).toEqual([6000, 7000]);
  });
});
