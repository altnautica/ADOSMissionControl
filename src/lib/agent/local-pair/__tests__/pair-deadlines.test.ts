/**
 * @module local-pair/pair-deadlines.test
 * @description A pair call nothing answered reads as the unreachable copy,
 * never a raw fetch error, on the proxy path a browser always takes; unpair
 * is bounded by the same deadline; an operator abort passes through.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeAgent } from "../probe";
import { unpairLocal } from "../unpair";
import { PairClientError } from "../errors";

const HOST = "http://192.168.1.50:8080";

function rejectFetch(err: unknown) {
  const fetchMock = vi.fn().mockRejectedValue(err);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeAgent over the proxy route", () => {
  it("maps a timed-out proxy call onto the unreachable copy", async () => {
    const fetchMock = rejectFetch(new DOMException("timed out", "TimeoutError"));
    const err = await probeAgent(HOST).catch((e: unknown) => e);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/lan-pair/probe");
    expect(err).toBeInstanceOf(PairClientError);
  });

  it("re-throws an operator abort untouched", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const abort = new DOMException("aborted", "AbortError");
    rejectFetch(abort);
    await expect(probeAgent(HOST, ctrl.signal)).rejects.toBe(abort);
  });
});

describe("unpairLocal", () => {
  it("bounds the call with a deadline even when the caller passes no signal", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await unpairLocal(HOST, "k");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a call nothing answered onto the unreachable copy", async () => {
    rejectFetch(new TypeError("fetch failed"));
    await expect(unpairLocal(HOST, "k")).rejects.toBeInstanceOf(PairClientError);
  });
});
