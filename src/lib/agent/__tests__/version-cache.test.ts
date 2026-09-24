/**
 * A transient `/api/version` failure must not pin a node's capability set.
 *
 * The cache stored `info: null` for every failure and honoured it for five
 * minutes, so one aborted request during bring-up made `agentSupports()`
 * answer false for everything until the TTL expired — the GCS took legacy
 * code paths against a fully capable agent long after it had recovered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  fetchVersionInfo,
  agentSupports,
} from "../agent-client/version-cache";
import type { RequestContext } from "../agent-client/transport";

const CTX: RequestContext = { baseUrl: "http://node.local:8080", apiKey: "k" };

const VERSION_BODY = {
  api_version: "1",
  agent_version: "0.9.0",
  capabilities: ["swarm"],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchVersionInfo caching", () => {
  beforeEach(() => {
    // Each test uses its own baseUrl so the module-level cache cannot leak
    // between them; see the per-test `ctx()` helper.
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  let n = 0;
  const ctx = (): RequestContext => ({ ...CTX, baseUrl: `http://n${n++}:8080` });

  it("does not cache a transient failure, so the next call retries", async () => {
    const c = ctx();
    const fetchMock = vi
      .fn()
      // A deadline abort: never reached the agent.
      .mockRejectedValueOnce(new DOMException("aborted", "TimeoutError"))
      .mockResolvedValueOnce(jsonResponse(VERSION_BODY));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchVersionInfo(c)).toBeNull();

    // Without `force`. A cached negative would short-circuit here and the
    // node would stay capability-less for the whole 5 min TTL.
    const recovered = await fetchVersionInfo(c);
    expect(recovered).not.toBeNull();
    expect(agentSupports(recovered, "swarm")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches a 404 as a durable absence and stops re-asking", async () => {
    const c = ctx();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchVersionInfo(c)).toBeNull();
    expect(await fetchVersionInfo(c)).toBeNull();
    // A pre-0.8.6 agent genuinely has no endpoint; one probe is enough.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves a success from cache and re-fetches on force", async () => {
    const c = ctx();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VERSION_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchVersionInfo(c);
    expect(agentSupports(first, "swarm")).toBe(true);
    await fetchVersionInfo(c);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fetchVersionInfo(c, { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const c = ctx();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VERSION_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const answers = await Promise.all([
      fetchVersionInfo(c),
      fetchVersionInfo(c),
      fetchVersionInfo(c),
    ]);
    expect(answers.every((a) => agentSupports(a, "swarm"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a shared request failed transiently", async () => {
    const c = ctx();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "TimeoutError"))
      .mockResolvedValueOnce(jsonResponse(VERSION_BODY));
    vi.stubGlobal("fetch", fetchMock);

    expect(await Promise.all([fetchVersionInfo(c), fetchVersionInfo(c)])).toEqual([
      null,
      null,
    ]);
    expect(agentSupports(await fetchVersionInfo(c), "swarm")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
