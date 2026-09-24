/**
 * Device authentication on the agent-facing HTTP routes, exercised by
 * calling the real route handlers.
 *
 * This file used to `readFile` `convex/http.ts` and assert that the source
 * contained the string `request.headers.get("X-ADOS-Key") ?? undefined`.
 * That proves nothing: it passes on a route that reads the header and then
 * ignores it, and it fails on a route that is correct but formatted
 * differently. `httpRouter()` exposes its registered routes and each
 * `httpAction` carries its handler, so the routes can simply be called.
 *
 * The key travels in `X-ADOS-Key`, never in a query string, because a URL
 * lands in browser history and in every access log on the path.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import http from "../../convex/http";

// ── router access ────────────────────────────────────────────────────

type RouteHandler = (ctx: unknown, request: Request) => Promise<Response>;

interface RegisteredAction {
  _handler: RouteHandler;
}

function routeHandler(path: string, method: string): RouteHandler {
  const router = http as unknown as {
    getRoutes: () => Array<[string, string, RegisteredAction]>;
  };
  const found = router
    .getRoutes()
    .find(([p, m]) => p === path && m === method);
  if (!found) throw new Error(`no route registered for ${method} ${path}`);
  const handler = found[2]?._handler;
  if (typeof handler !== "function") {
    throw new Error(`route ${method} ${path} exposes no callable handler`);
  }
  return handler;
}

/** A ctx whose `runMutation`/`runQuery` answer with a fixed value. */
function ctxReturning(value: unknown) {
  const calls: Array<{ args: unknown }> = [];
  return {
    calls,
    ctx: {
      runMutation: async (_ref: unknown, args: unknown) => {
        calls.push({ args });
        return value;
      },
      runQuery: async (_ref: unknown, args: unknown) => {
        calls.push({ args });
        return value;
      },
    },
  };
}

function postJson(url: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ── the enumeration oracle ───────────────────────────────────────────

// ── the device-key routes ────────────────────────────────────────────

describe("device-key routes reject an unauthenticated caller", () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["/agent/status", "POST", { deviceId: "d1", version: "1", uptimeSeconds: 1 }],
    ["/agent/commands/ack", "POST", { deviceId: "d1", commandId: "c1" }],
    ["/agent/atlas-jobs", "POST", { deviceId: "d1", jobId: "j1" }],
  ];

  for (const [path, method, body] of cases) {
    it(`${method} ${path} refuses a request with no key`, async () => {
      const { ctx, calls } = ctxReturning(null);
      const res = await routeHandler(path, method)(
        ctx,
        postJson(`https://x.invalid${path}`, body),
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      // A refusal must not have reached a mutation that writes.
      const wrote = calls.some(
        (c) => c.args && typeof c.args === "object" && "version" in c.args,
      );
      expect(wrote).toBe(false);
    });

    it(`${method} ${path} refuses a key supplied in the query string`, async () => {
      const { ctx } = ctxReturning(null);
      const res = await routeHandler(path, method)(
        ctx,
        postJson(`https://x.invalid${path}?apiKey=secret`, body),
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  }
});

// ── registration rate-limit key ──────────────────────────────────────

describe("POST /pairing/register client bucket", () => {
  const handler = () => routeHandler("/pairing/register", "POST");
  const body = { deviceId: "d1", pairingCode: "ABC234", apiKey: "k" };

  async function clientKey(headers: HeadersInit): Promise<string> {
    const { ctx, calls } = ctxReturning({ registered: true });
    await handler()(ctx, postJson("https://x.invalid/pairing/register", body, headers));
    return (calls[0].args as { clientKey: string }).clientKey;
  }

  it("ignores a client-chosen first forwarded hop", async () => {
    const a = await clientKey({ "x-forwarded-for": "198.51.100.1, 192.0.2.7" });
    const b = await clientKey({ "x-forwarded-for": "198.51.100.2, 192.0.2.7" });
    expect(a).toBe(b);
  });

  it("keys on the edge-set client address when present", async () => {
    const a = await clientKey({
      "cf-connecting-ip": "192.0.2.7",
      "x-forwarded-for": "198.51.100.1, 203.0.113.5",
    });
    const b = await clientKey({
      "cf-connecting-ip": "192.0.2.7",
      "x-forwarded-for": "198.51.100.2, 203.0.113.6",
    });
    const c = await clientKey({ "cf-connecting-ip": "192.0.2.8" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
