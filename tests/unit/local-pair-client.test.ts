/**
 * Verifies the local-pair-client URL normaliser and the typed
 * PairClientError details filter. Both are pure functions that the
 * pair flow leans on heavily.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normaliseHost,
  PairClientError,
  findHostByCodeOnLan,
} from "@/lib/agent/local-pair-client";

describe("normaliseHost", () => {
  it("appends http:// and :8080 to a bare hostname", () => {
    expect(normaliseHost("skynode.local")).toBe("http://skynode.local:8080");
  });

  it("appends :8080 to an http://host without a port", () => {
    expect(normaliseHost("http://skynode.local")).toBe(
      "http://skynode.local:8080",
    );
  });

  it("preserves an explicit non-8080 port on http", () => {
    expect(normaliseHost("http://skynode.local:9999")).toBe(
      "http://skynode.local:9999",
    );
  });

  it("leaves https URLs alone (does NOT force :8080 onto TLS)", () => {
    // normaliseHost strips trailing slashes, so the URL constructor's
    // canonicalised "https://host/" comes back as "https://host".
    expect(normaliseHost("https://drone.example.com")).toBe(
      "https://drone.example.com",
    );
    expect(normaliseHost("https://drone.example.com:8443")).toBe(
      "https://drone.example.com:8443",
    );
  });

  it("strips trailing slashes", () => {
    expect(normaliseHost("http://skynode.local:8080/")).toBe(
      "http://skynode.local:8080",
    );
    expect(normaliseHost("http://skynode.local:8080///")).toBe(
      "http://skynode.local:8080",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseHost("  skynode.local  ")).toBe("http://skynode.local:8080");
  });

  it("returns empty string for empty input", () => {
    expect(normaliseHost("")).toBe("");
    expect(normaliseHost("   ")).toBe("");
  });

  it("preserves a numeric IP host", () => {
    expect(normaliseHost("192.168.1.42")).toBe("http://192.168.1.42:8080");
  });
});

describe("PairClientError", () => {
  it("carries code + message", () => {
    const e = new PairClientError("pairUnreachableError", "Nothing answered");
    expect(e.code).toBe("pairUnreachableError");
    expect(e.message).toBe("Nothing answered");
    expect(e.name).toBe("PairClientError");
  });

  it("filters object-valued details to JSON strings", () => {
    const e = new PairClientError("x", "x", {
      status: 500,
      statusText: "Internal",
      nested: { a: 1 },
    });
    expect(e.details).toEqual({
      status: 500,
      statusText: "Internal",
      nested: JSON.stringify({ a: 1 }),
    });
  });

  it("coerces null and undefined details to empty strings", () => {
    const e = new PairClientError("x", "x", {
      keep: "ok",
      drop: null,
    });
    expect(e.details.keep).toBe("ok");
    expect(e.details.drop).toBe("");
  });

  it("accepts an empty details bag", () => {
    const e = new PairClientError("enterHostnameError", "Enter a host");
    expect(e.details).toEqual({});
  });
});

describe("findHostByCodeOnLan", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetchSequence(
    routes: Record<string, { ok: boolean; body: unknown }>,
  ) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        // For probe, key by the host in the body.
        if (u.includes("/api/lan-pair/probe")) {
          const body = JSON.parse((init?.body as string) ?? "{}");
          const key = `probe:${body.host}`;
          const r = routes[key];
          if (!r) return new Response(null, { status: 404 });
          return new Response(JSON.stringify(r.body), {
            status: r.ok ? 200 : 500,
          });
        }
        const r = routes[u];
        if (!r) return new Response(null, { status: 404 });
        return new Response(JSON.stringify(r.body), {
          status: r.ok ? 200 : 500,
        });
      },
    );
  }

  it("returns the mdns_host of the agent whose code matches", async () => {
    mockFetchSequence({
      "/api/lan-pair/discover": {
        ok: true,
        body: {
          agents: [
            { host: "ados-aa.local", ipv4: "192.168.1.10", port: 8080, txt: {} },
            { host: "ados-bb.local", ipv4: "192.168.1.11", port: 8080, txt: {} },
          ],
        },
      },
      "probe:ados-aa.local": {
        ok: true,
        body: {
          device_id: "aa",
          name: "ados-aa",
          pairing_code: "ZZZZZZ",
          paired: false,
          mdns_host: "ados-aa.local",
        },
      },
      "probe:192.168.1.10": {
        ok: true,
        body: {
          device_id: "aa",
          name: "ados-aa",
          pairing_code: "ZZZZZZ",
          paired: false,
          mdns_host: "ados-aa.local",
        },
      },
      "probe:ados-bb.local": {
        ok: true,
        body: {
          device_id: "bb",
          name: "ados-bb",
          pairing_code: "NCBH76",
          paired: false,
          mdns_host: "ados-bb.local",
        },
      },
      "probe:192.168.1.11": {
        ok: true,
        body: {
          device_id: "bb",
          name: "ados-bb",
          pairing_code: "NCBH76",
          paired: false,
          mdns_host: "ados-bb.local",
        },
      },
    });
    const out = await findHostByCodeOnLan("NCBH76");
    expect(out.matchedHost).toBe("ados-bb.local");
    expect(out.unpaired).toHaveLength(2);
    expect(out.unpaired.map((a) => a.code).sort()).toEqual(["NCBH76", "ZZZZZZ"]);
  });

  it("falls back to the IPv4 when the agent omits mdns_host", async () => {
    mockFetchSequence({
      "/api/lan-pair/discover": {
        ok: true,
        body: {
          agents: [
            { host: "ados-cc.local", ipv4: "192.168.1.12", port: 8080, txt: {} },
          ],
        },
      },
      "probe:ados-cc.local": { ok: false, body: {} },
      "probe:192.168.1.12": {
        ok: true,
        body: { device_id: "cc", name: "ados-cc", pairing_code: "S4KK24", paired: false },
      },
    });
    const out = await findHostByCodeOnLan("S4KK24");
    expect(out.matchedHost).toBe("192.168.1.12");
  });

  it("skips agents that are already paired even if the code matches", async () => {
    mockFetchSequence({
      "/api/lan-pair/discover": {
        ok: true,
        body: {
          agents: [
            { host: "ados-dd.local", ipv4: "192.168.1.13", port: 8080, txt: {} },
          ],
        },
      },
      "probe:ados-dd.local": {
        ok: true,
        body: {
          device_id: "dd",
          name: "ados-dd",
          pairing_code: "X9N883",
          paired: true,
          mdns_host: "ados-dd.local",
        },
      },
      "probe:192.168.1.13": {
        ok: true,
        body: {
          device_id: "dd",
          name: "ados-dd",
          pairing_code: "X9N883",
          paired: true,
          mdns_host: "ados-dd.local",
        },
      },
    });
    const out = await findHostByCodeOnLan("X9N883");
    expect(out.matchedHost).toBe(null);
    expect(out.unpaired).toEqual([]);
  });

  it("returns null match when the discover route returns no agents", async () => {
    mockFetchSequence({
      "/api/lan-pair/discover": { ok: true, body: { agents: [] } },
    });
    const out = await findHostByCodeOnLan("NCBH76");
    expect(out.matchedHost).toBe(null);
    expect(out.unpaired).toEqual([]);
  });

  it("returns the unpaired summary when no agent advertises the requested code", async () => {
    mockFetchSequence({
      "/api/lan-pair/discover": {
        ok: true,
        body: {
          agents: [
            { host: "ados-ee.local", ipv4: "192.168.1.14", port: 8080, txt: {} },
          ],
        },
      },
      "probe:ados-ee.local": {
        ok: true,
        body: {
          device_id: "ee",
          name: "ados-ee",
          pairing_code: "WRONG1",
          paired: false,
          mdns_host: "ados-ee.local",
        },
      },
      "probe:192.168.1.14": {
        ok: true,
        body: {
          device_id: "ee",
          name: "ados-ee",
          pairing_code: "WRONG1",
          paired: false,
          mdns_host: "ados-ee.local",
        },
      },
    });
    const out = await findHostByCodeOnLan("NCBH76");
    expect(out.matchedHost).toBe(null);
    expect(out.unpaired).toHaveLength(1);
    expect(out.unpaired[0].code).toBe("WRONG1");
    expect(out.unpaired[0].name).toBe("ados-ee");
  });

  it("swallows per-agent probe errors so one slow node doesn't poison the scan", async () => {
    mockFetchSequence({
      "/api/lan-pair/discover": {
        ok: true,
        body: {
          agents: [
            { host: "broken.local", ipv4: "192.168.1.15", port: 8080, txt: {} },
            { host: "good.local", ipv4: "192.168.1.16", port: 8080, txt: {} },
          ],
        },
      },
      "probe:broken.local": { ok: false, body: {} },
      "probe:192.168.1.15": { ok: false, body: { error: "upstream_unreachable" } },
      "probe:good.local": {
        ok: true,
        body: {
          device_id: "good",
          name: "good",
          pairing_code: "NCBH76",
          paired: false,
          mdns_host: "good.local",
        },
      },
      "probe:192.168.1.16": {
        ok: true,
        body: {
          device_id: "good",
          name: "good",
          pairing_code: "NCBH76",
          paired: false,
          mdns_host: "good.local",
        },
      },
    });
    const out = await findHostByCodeOnLan("NCBH76");
    expect(out.matchedHost).toBe("good.local");
  });

  it("returns null match when the discover route fails entirely", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    const out = await findHostByCodeOnLan("NCBH76");
    expect(out.matchedHost).toBe(null);
    expect(out.unpaired).toEqual([]);
  });
});
