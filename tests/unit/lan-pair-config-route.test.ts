/**
 * Verifies the LAN config proxy: envelope method → upstream call mapping
 * (GET/PUT hit /api/config, POST hits the setup apply endpoint), the
 * `X-ADOS-Key` forwarding, verbatim status + body passthrough (so the
 * agent's `{error}` payloads and 422 messages surface unchanged), and the
 * 400 rejections that never reach the agent.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// The route resolves the upstream base via node:dns; stub it so the test
// stays a pure HTTP-shape assertion and never touches the resolver.
vi.mock("@/app/api/lan-pair/_ipv4", () => ({
  ipv4FetchBase: vi.fn(async (target: { url: string }) => target.url),
}));

import { POST } from "@/app/api/lan-pair/config/route";

function postJson(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/lan-pair/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("lan-pair config proxy", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards a GET envelope to GET /api/config with the pairing key", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ logging: { level: "info" } }), {
        status: 200,
      }),
    );
    const res = await POST(
      postJson({ host: "bench-node.local", apiKey: "k-123", method: "GET" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logging: { level: "info" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://bench-node.local:8080/api/config");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers["X-ADOS-Key"]).toBe("k-123");
  });

  it("forwards a PUT envelope body verbatim to PUT /api/config", async () => {
    const res = await POST(
      postJson({
        host: "192.168.1.50",
        apiKey: "k-123",
        method: "PUT",
        body: { key: "logging.level", value: "debug" },
      }),
    );
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://192.168.1.50:8080/api/config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      key: "logging.level",
      value: "debug",
    });
  });

  it("forwards a POST envelope to the setup apply endpoint", async () => {
    const res = await POST(
      postJson({
        host: "bench-node.local",
        apiKey: "k-123",
        method: "POST",
        body: { ui: { theme: "dark" } },
      }),
    );
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://bench-node.local:8080/api/v1/setup/apply");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ ui: { theme: "dark" } });
  });

  it("relays the agent's error status + body verbatim", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unknown config key" }), {
        status: 422,
      }),
    );
    const res = await POST(
      postJson({
        host: "bench-node.local",
        apiKey: "k-123",
        method: "PUT",
        body: { key: "nope", value: "1" },
      }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "unknown config key" });
  });

  it("rejects a non-private host before reaching the agent", async () => {
    const res = await POST(
      postJson({ host: "example.com", method: "GET" }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported method before reaching the agent", async () => {
    const res = await POST(
      postJson({ host: "bench-node.local", method: "DELETE" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_method");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a write with no object body before reaching the agent", async () => {
    const res = await POST(
      postJson({ host: "bench-node.local", method: "PUT" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_body");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps an unreachable agent to 502 upstream_unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const res = await POST(
      postJson({ host: "bench-node.local", method: "GET" }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream_unreachable");
  });
});
