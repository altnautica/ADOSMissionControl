import { describe, it, expect } from "vitest";

import {
  MavlinkSigner,
  importNonExtractableKey,
} from "@/lib/protocol/mavlink-signer";

/**
 * Perf micro-benchmark for the browser signer. Reports wall-clock
 * duration and per-operation latency; no hard gate. The number is
 * useful as a regression observable across releases.
 *
 * Expectation on a mid-range laptop (M1, i5-1240P class): sign() takes
 * 50-200us. A 1000-frame burst should land under 500ms.
 *
 * If this test ever runs slower than 2000ms in CI, investigate: the
 * likely culprit is a Web Crypto regression or a Vitest environment
 * change (node crypto.subtle performance varies by Node version).
 */
describe("signing perf micro-bench", () => {
  it("signs 1000 frames under 2 seconds on a test runner", async () => {
    const keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) keyBytes[i] = (i * 7) & 0xff;
    const key = await importNonExtractableKey(keyBytes);
    const signer = new MavlinkSigner("perf-drone", 42, "perfkey0", key);

    const frame = new Uint8Array(64);
    for (let i = 0; i < 64; i++) frame[i] = (i * 13) & 0xff;

    const N = 1000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      await signer.sign(frame);
    }
    const durationMs = performance.now() - t0;
    const perOpUs = (durationMs * 1000) / N;

     
    console.log(
      `[signing-perf] ${N} sign() ops in ${durationMs.toFixed(1)}ms, ${perOpUs.toFixed(1)}us/op`,
    );

    expect(durationMs).toBeLessThan(2000);
  });

  it("verifies 1000 frames under 2 seconds on a test runner", async () => {
    const keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) keyBytes[i] = (i * 11) & 0xff;
    const key = await importNonExtractableKey(keyBytes);
    const signer = new MavlinkSigner("perf-drone-v", 17, "perfkey1", key);

    // Pre-sign 1000 frames so verify() doesn't include sign() cost.
    const frame = new Uint8Array(64);
    for (let i = 0; i < 64; i++) frame[i] = (i * 19) & 0xff;
    const tails: Uint8Array[] = [];
    for (let i = 0; i < 1000; i++) {
      tails.push(await signer.sign(frame));
    }

    const t0 = performance.now();
    let validCount = 0;
    for (let i = 0; i < tails.length; i++) {
      if (await signer.verify(frame, tails[i])) validCount++;
    }
    const durationMs = performance.now() - t0;
    const perOpUs = (durationMs * 1000) / tails.length;

     
    console.log(
      `[signing-perf] ${tails.length} verify() ops in ${durationMs.toFixed(1)}ms, ${perOpUs.toFixed(1)}us/op`,
    );

    expect(validCount).toBe(tails.length);
    expect(durationMs).toBeLessThan(2000);
  });
});
