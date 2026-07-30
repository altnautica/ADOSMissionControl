/**
 * @module relay-url.test
 * @description Unit coverage for the relay-proxy install transport's
 * request bound. `fetch` and the timers are stubbed so the abort can be
 * driven deterministically.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  installRelayFromUrl,
  RELAY_INSTALL_TIMEOUT_MS,
} from "../relay-url";
import { LanDirectError } from "../lan-direct";

/** The ground station bounds one relay-proxy call at 10 s
 * (`RPC_DEFAULT_TIMEOUT`), and the drone bounds its own local HTTP call
 * at 5 s (`HTTP_TIMEOUT`). Both are agent-side constants this client
 * cannot change; it can only sit correctly above them. */
const GROUND_STATION_CALL_BOUND_MS = 10_000;

const baseInputs = {
  relayBaseUrl:
    "http://ground.local:8080/api/v1/ground-station/relay-proxy/peer-1",
  apiKey: "test-key",
  url: "https://example.invalid/archive.adosplug",
  sha256: "deadbeef",
  jobId: "job-1",
  pluginId: "test.plugin",
  pluginName: "Test Plugin",
  deviceId: "device-1",
};

describe("installRelayFromUrl request bound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sits above the ground station's call bound but well inside the ladder", () => {
    // The relay ladder is drone 5 s -> ground station 10 s -> this
    // client. A client bound below 10 s would abort while the ground
    // station is still waiting, discarding the specific error it is
    // about to return; a bound far above it (the old 90 s) can never be
    // reached, because the ground station always answers or times out
    // first.
    expect(RELAY_INSTALL_TIMEOUT_MS).toBeGreaterThan(
      GROUND_STATION_CALL_BOUND_MS,
    );
    expect(RELAY_INSTALL_TIMEOUT_MS).toBeLessThanOrEqual(
      GROUND_STATION_CALL_BOUND_MS * 2,
    );
  });

  it("stays pending past the ground station's own bound, then aborts", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as unknown);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const settled = vi.fn();
    const promise = installRelayFromUrl(baseInputs).then(settled, settled);

    // The ground station's 10 s bound elapses: it answers with its own
    // 504 rather than this client giving up first.
    await vi.advanceTimersByTimeAsync(GROUND_STATION_CALL_BOUND_MS);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(
      RELAY_INSTALL_TIMEOUT_MS - GROUND_STATION_CALL_BOUND_MS,
    );
    await promise;

    expect(settled).toHaveBeenCalledTimes(1);
    const err = settled.mock.calls[0][0] as unknown;
    expect(err).toBeInstanceOf(LanDirectError);
    expect((err as LanDirectError).cause).toBe("timeout");
  });
});
