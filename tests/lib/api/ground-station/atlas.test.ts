import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAtlasRelayStatus } from "@/lib/api/ground-station/atlas";
import type { RequestContext } from "@/lib/api/ground-station/request";

const ctx: RequestContext = { baseUrl: "http://gs.test.local", apiKey: "test-key" };

describe("getAtlasRelayStatus", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function respond(res: Response | Error) {
    globalThis.fetch = vi.fn(() =>
      res instanceof Error ? Promise.reject(res) : Promise.resolve(res),
    ) as unknown as typeof fetch;
  }

  it("reports a transport failure as unreachable, not as no relay", async () => {
    respond(new TypeError("Failed to fetch"));
    expect(await getAtlasRelayStatus(ctx)).toEqual({ kind: "unreachable" });
  });

  it("reports a 5xx as unreachable", async () => {
    respond(new Response("proxy timeout", { status: 504 }));
    expect(await getAtlasRelayStatus(ctx)).toEqual({ kind: "unreachable" });
  });

  it("reports a 404 as no relay on this node", async () => {
    respond(new Response(JSON.stringify({ code: "E_WRONG_ROLE" }), { status: 404 }));
    expect(await getAtlasRelayStatus(ctx)).toEqual({ kind: "absent" });
  });

  it("keeps the agent's stale flag on a snapshot", async () => {
    respond(
      new Response(
        JSON.stringify({ up: null, datagrams_seen: null, forwarded: null, stale: true }),
        { status: 200 },
      ),
    );
    const read = await getAtlasRelayStatus(ctx);
    expect(read.kind).toBe("snapshot");
    if (read.kind === "snapshot") {
      expect(read.status.stale).toBe(true);
      expect(read.status.datagramsSeen).toBeNull();
    }
  });
});
