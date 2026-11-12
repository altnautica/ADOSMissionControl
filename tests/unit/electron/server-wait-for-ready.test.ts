/**
 * The desktop startup readiness probe: one HTTP probe at a time.
 *
 * @license GPL-3.0-only
 */

import { EventEmitter } from "events";
import { describe, it, expect, vi, afterEach } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("http", () => ({ default: { get }, get }));
vi.mock("electron", () => ({ app: { isPackaged: true, getAppPath: () => "/" } }));

import { waitForReady } from "../../../electron/server";

/** A request that times out and then errors, as `req.destroy()` does. */
class HangingRequest extends EventEmitter {
  private onTimeout: (() => void) | null = null;
  setTimeout(_ms: number, cb: () => void) {
    this.onTimeout = cb;
    return this;
  }
  destroy() {
    this.emit("error", new Error("socket hang up"));
  }
  fireTimeout() {
    this.onTimeout?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
  get.mockReset();
});

describe("waitForReady", () => {
  it("schedules one retry when a probe times out", async () => {
    vi.useFakeTimers();
    const requests: HangingRequest[] = [];
    get.mockImplementation(() => {
      const r = new HangingRequest();
      requests.push(r);
      return r;
    });
    const child = new EventEmitter();
    const done = waitForReady(1, child as never, 60_000).catch(() => undefined);

    expect(requests).toHaveLength(1);
    requests[0].fireTimeout();
    await vi.advanceTimersByTimeAsync(250);
    // Before: the timeout path and the destroy-driven error path each
    // scheduled a probe, so two requests were in flight here.
    expect(requests).toHaveLength(2);

    child.emit("exit", 1);
    await done;
  });
});
