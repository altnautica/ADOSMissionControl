// @vitest-environment node
/**
 * Verifies the LAN unpair proxy forwards the API key under the
 * `X-ADOS-Key` header the agent's auth middleware reads — not the
 * legacy `X-API-Key` name, which the agent ignores and 401s on,
 * silently leaving the agent paired.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// The route resolves the upstream base via node:dns; stub it so the test
// stays a pure HTTP-shape assertion and never touches the resolver.
vi.mock("@/app/api/lan-pair/_ipv4", () => ({
  agentFetchBase: vi.fn(async (target: { url: string }) => new URL(target.url).origin),
}));

import { POST } from "@/app/api/lan-pair/unpair/route";

function postJson(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/lan-pair/unpair", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

describe("lan-pair unpair proxy", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards the api key as X-ADOS-Key (not X-API-Key)", async () => {
    const res = await POST(postJson({ host: "testnode.local", apiKey: "k-123" }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-ADOS-Key"]).toBe("k-123");
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("relays the agent's status verbatim", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Missing X-ADOS-Key header" }), {
        status: 401,
      }),
    );
    const res = await POST(postJson({ host: "testnode.local", apiKey: "k-123" }));
    expect(res.status).toBe(401);
  });

  it("rejects a request with no api key before reaching the agent", async () => {
    const res = await POST(postJson({ host: "testnode.local" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
