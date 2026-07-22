import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentClient, agentSupports } from "@/lib/agent/client";
import type { AgentVersionInfo } from "@/lib/agent/types";

describe("agentSupports", () => {
  it("returns true when capability is in the list", () => {
    const info: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.6",
      capabilities: ["status.full", "video.pipeline"],
    };
    expect(agentSupports(info, "status.full")).toBe(true);
    expect(agentSupports(info, "video.pipeline")).toBe(true);
  });

  it("returns false when capability is missing", () => {
    const info: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.6",
      capabilities: ["status.full"],
    };
    expect(agentSupports(info, "video.pipeline")).toBe(false);
  });

  it("returns false when info is null or undefined", () => {
    expect(agentSupports(null, "status.full")).toBe(false);
    expect(agentSupports(undefined, "status.full")).toBe(false);
  });
});

describe("AgentClient.getVersion", () => {
  let originalFetch: typeof fetch;
  let unique = 0;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    unique += 1;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function uniqueClient(apiKey?: string) {
    // Force a fresh cache key per test so the module-level cache
    // doesn't leak between tests.
    return new AgentClient(`http://test-${unique}.local`, apiKey);
  }

  it("returns parsed version on success", async () => {
    const payload: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.6",
      capabilities: ["status.full", "version.endpoint"],
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    const client = uniqueClient();
    const info = await client.getVersion();
    expect(info).toEqual(payload);
  });

  it("returns null when /api/version is missing (older agent)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    const client = uniqueClient();
    const info = await client.getVersion();
    expect(info).toBeNull();
  });

  it("returns null on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = uniqueClient();
    const info = await client.getVersion();
    expect(info).toBeNull();
  });

  it("caches the result across consecutive calls", async () => {
    const payload: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.6",
      capabilities: ["status.full"],
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    globalThis.fetch = fetchSpy;
    const client = uniqueClient();
    const a = await client.getVersion();
    const b = await client.getVersion();
    expect(a).toEqual(payload);
    expect(b).toEqual(payload);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("force option bypasses cache", async () => {
    const payload: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.6",
      capabilities: [],
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    globalThis.fetch = fetchSpy;
    const client = uniqueClient();
    await client.getVersion();
    await client.getVersion({ force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("AgentClient.supports", () => {
  let originalFetch: typeof fetch;
  let unique = 100;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    unique += 1;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns true when capability is advertised", async () => {
    const payload: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.6",
      capabilities: ["video.pipeline"],
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    const client = new AgentClient(`http://supports-${unique}.local`);
    expect(await client.supports("video.pipeline")).toBe(true);
    expect(await client.supports("nonexistent.capability")).toBe(false);
  });

  it("returns false when /api/version is unavailable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("missing", { status: 404 }),
    );
    const client = new AgentClient(`http://supports-${unique}.local`);
    expect(await client.supports("anything")).toBe(false);
  });
});

describe("AgentClient.getFullStatus capability gating", () => {
  let originalFetch: typeof fetch;
  let unique = 200;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    unique += 1;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("skips /api/status/full when capability not advertised", async () => {
    const versionPayload: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.7.0",
      capabilities: [], // no status.full
    };
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/version")) {
        return new Response(JSON.stringify(versionPayload), { status: 200 });
      }
      // Should never be called
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchSpy;
    const client = new AgentClient(`http://gate-${unique}.local`);
    const result = await client.getFullStatus();
    expect(result).toBeNull();
    const calls = fetchSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c: string) => c.includes("/api/status/full"))).toBe(false);
  });

  it("calls /api/status/full when capability is advertised", async () => {
    const versionPayload: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.6",
      capabilities: ["status.full"],
    };
    const fullPayload = { agent: { version: "0.8.6" } };
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/version")) {
        return new Response(JSON.stringify(versionPayload), { status: 200 });
      }
      if (url.includes("/api/status/full")) {
        return new Response(JSON.stringify(fullPayload), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchSpy;
    const client = new AgentClient(`http://gate-${unique}.local`);
    const result = await client.getFullStatus();
    expect(result).toEqual(fullPayload);
  });

  it("calls /api/status/full and falls back when version is unavailable", async () => {
    const fullPayload = { agent: { version: "unknown" } };
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/version")) {
        return new Response("missing", { status: 404 });
      }
      if (url.includes("/api/status/full")) {
        return new Response(JSON.stringify(fullPayload), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchSpy;
    const client = new AgentClient(`http://gate-${unique}.local`);
    const result = await client.getFullStatus();
    expect(result).toEqual(fullPayload);
  });
});

describe("AgentClient schema fallback policy", () => {
  let originalFetch: typeof fetch;
  let unique = 300;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    unique += 1;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("allows display-status payloads to degrade on schema drift", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const payload = { agent: { version: "legacy" } };
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/version")) {
        return new Response(JSON.stringify({
          api_version: "1",
          agent_version: "0.8.6",
          capabilities: ["status.full"],
        }), { status: 200 });
      }
      if (url.includes("/api/status/full")) {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = fetchSpy;

    const client = new AgentClient(`http://fallback-${unique}.local`);
    await expect(client.getFullStatus()).resolves.toEqual(payload);
  });

  it("fails closed for a command response carrying no acknowledgement", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const client = new AgentClient(`http://strict-${unique}.local`);
    // An envelope with no acknowledgement block means the vehicle never
    // answered. That is reported as an unsuccessful command, never as a
    // success — a caller must not read "sent" as "done".
    const result = await client.sendCommand("arm");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no acknowledgement/i);
  });

  it("names the command on the field the agent's command route reads", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          cmd: "takeoff",
          ack: { observed: true, accepted: true, result: 0, result_name: "ACCEPTED" },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchSpy;

    const client = new AgentClient(`http://wire-${unique}.local`);
    const result = await client.sendCommand("takeoff", [25]);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as { body: string }).body,
    );
    expect(body).toEqual({ cmd: "takeoff", args: [25] });
    expect(result.success).toBe(true);
  });
});
