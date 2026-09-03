/**
 * @module protocol/mavlink-adapter-params.test
 * @description The bulk parameter download state machine, exercised with a
 * fake transport that never actually decodes MAVLink — `getAllParameters`
 * only needs `transport.isConnected` and `transport.send`, and the download
 * itself is driven by feeding synthetic `ParameterValue` frames straight into
 * `ctx.parameterDownload.params` the way `handleParamValueFrame` would.
 *
 * Covers two real bugs fixed together: a second concurrent `getAllParameters`
 * call used to silently abandon the first caller's promise (two competing
 * `ParamDownloadState` objects, only the newer one still fed by incoming
 * frames), and a fixed 3-retry-round cap gave up on a lossy link that was
 * still genuinely converging, well short of the 120s hard timeout that
 * already bounds the whole download.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getAllParameters,
  retryMissingParams,
  setParameter,
  finishParamDownload,
  type ParamContext,
} from "../mavlink-adapter-params";
import type { ParameterValue, Transport } from "../types";

function fakeTransport(): Transport {
  return {
    type: "websocket",
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isConnected: true,
  } as unknown as Transport;
}

function makeCtx(): ParamContext {
  return {
    transport: fakeTransport(),
    firmwareHandler: null,
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    paramCache: new Map(),
    PARAM_CACHE_TTL_MS: 300000,
    parameterDownload: null,
    downloadedParamNames: null,
    onParameter: () => () => {},
  };
}

function param(index: number, count: number, name = `P${index}`): ParameterValue {
  return { name, value: index, type: 9, index, count };
}

describe("getAllParameters re-entrancy", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shares one download instead of starting a second one", async () => {
    const ctx = makeCtx();

    const first = getAllParameters(ctx);
    // A second call while the first is in flight must NOT replace
    // ctx.parameterDownload with a competing state object.
    const dlBefore = ctx.parameterDownload;
    const second = getAllParameters(ctx);
    expect(ctx.parameterDownload).toBe(dlBefore);
    expect(ctx.parameterDownload?.resolvers.length).toBe(2);

    // Simulate two PARAM_VALUE frames landing (as the frame handler would
    // write them) and the download completing.
    ctx.parameterDownload!.total = 2;
    ctx.parameterDownload!.params.set(0, param(0, 2));
    ctx.parameterDownload!.params.set(1, param(1, 2));
    finishParamDownload(ctx);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toHaveLength(2);
    expect(secondResult).toHaveLength(2);
    expect(ctx.parameterDownload).toBeNull();
  });
});

describe("retryMissingParams convergence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps retrying while each round shrinks the missing set", () => {
    const ctx = makeCtx();
    void getAllParameters(ctx);
    const dl = ctx.parameterDownload!;
    dl.total = 100;
    // 40 of 100 collected — 60 missing.
    for (let i = 0; i < 40; i++) dl.params.set(i, param(i, 100));

    retryMissingParams(ctx);
    expect(ctx.parameterDownload).not.toBeNull(); // still going
    expect(dl.noProgressRounds).toBe(0);

    // Round genuinely shrinks the gap: 70 collected now, 30 missing.
    for (let i = 40; i < 70; i++) dl.params.set(i, param(i, 100));
    retryMissingParams(ctx);
    expect(ctx.parameterDownload).not.toBeNull();
    expect(dl.noProgressRounds).toBe(0);
    expect(dl.lastMissingCount).toBe(30);
  });

  it("gives up after six consecutive rounds with no progress, not a fixed round count", () => {
    const ctx = makeCtx();
    void getAllParameters(ctx);
    const dl = ctx.parameterDownload!;
    dl.total = 10;
    dl.params.set(0, param(0, 10)); // 9 missing, never closes

    // Six consecutive stalls are tolerated (grace window for a lossy link
    // that's still inside the 120s hard backstop); the seventh stall gives up.
    for (let round = 1; round <= 6; round++) {
      retryMissingParams(ctx);
      expect(ctx.parameterDownload).not.toBeNull();
    }
    retryMissingParams(ctx); // round 7: six consecutive stalls — give up
    expect(ctx.parameterDownload).toBeNull();
  });

  it("finishes immediately once nothing is missing", () => {
    const ctx = makeCtx();
    void getAllParameters(ctx);
    const dl = ctx.parameterDownload!;
    dl.total = 3;
    for (let i = 0; i < 3; i++) dl.params.set(i, param(i, 3));

    retryMissingParams(ctx);
    expect(ctx.parameterDownload).toBeNull();
  });
});

describe("setParameter write path", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A ctx whose onParameter subscriptions are observable and drivable. */
  function writeCtx() {
    const subs = new Set<(p: ParameterValue) => void>();
    const ctx = makeCtx();
    ctx.onParameter = (cb: (p: ParameterValue) => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    };
    return {
      ctx,
      subs,
      echo: (name: string, value: number) => {
        for (const cb of [...subs]) cb({ name, value, type: 9, index: 0, count: 1 });
      },
      sent: () => (ctx.transport!.send as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    };
  }

  it("resolves on the vehicle's echo and releases its subscription", async () => {
    const h = writeCtx();
    const promise = setParameter(h.ctx, "SR0_POSITION", 4);
    expect(h.subs.size).toBe(1);
    h.echo("SR0_POSITION", 4);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(h.subs.size).toBe(0);
  });

  it("retransmits a lost write instead of failing on the first miss", async () => {
    const h = writeCtx();
    const promise = setParameter(h.ctx, "SR0_POSITION", 4);
    expect(h.sent()).toBe(1);

    // MAVLink puts retransmission on the GCS: the vehicle answers a write with
    // a PARAM_VALUE echo and nothing else, so silence means resend.
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sent()).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sent()).toBe(3);

    // The echo for the third attempt still resolves it successfully.
    h.echo("SR0_POSITION", 4);
    expect((await promise).success).toBe(true);
  });

  it("leaks no subscription when every attempt is lost", async () => {
    const h = writeCtx();
    const promise = setParameter(h.ctx, "SR0_POSITION", 4);
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/timed out after 3 attempts/);
    // The timeout path used to resolve without unsubscribing, so a bulk panel
    // save on a lossy link left one permanent callback per failed write.
    expect(h.subs.size).toBe(0);
  });

  it("reports a value the vehicle refused to take", async () => {
    const h = writeCtx();
    const promise = setParameter(h.ctx, "SR0_POSITION", 4);
    h.echo("SR0_POSITION", 0); // clamped or rejected by the FC
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toContain("= 0");
    expect(h.subs.size).toBe(0);
  });
});
