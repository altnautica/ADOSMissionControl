/**
 * The config proxy's relay lane: a drone reached only through a ground
 * station's WFB relay has no IP address of its own, so this route composing
 * `/api/v1/ground-station/relay-proxy/<peer>/api/config` is the ONLY path its
 * settings surface has.
 *
 * The route's standing security property is that upstream paths are fixed
 * server-side "so the proxy can never be steered at an arbitrary agent path".
 * The relay lane adds exactly one variable segment, so these tests pin both
 * halves: the composed URL is exactly the fixed suffix behind a validated peer
 * segment, and a peer id that could steer the path is refused BEFORE any fetch
 * happens.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import {
  getConfigViaAccess,
  setConfigValueViaAccess,
} from "@/lib/agent/config-access";
import type { RelayReach } from "@/lib/nodes/relay-reach";

const GS_HOST = "http://192.168.1.50:8080";
const PEER = "77735cd38937";

/** Captured upstream calls, so a test can assert a URL was never built. */
let calls: { url: string; init: RequestInit }[] = [];

function upstreamAnswers(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(
        new Response(body, {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
}

/** The route reads its envelope with `req.json()`, so a plain Request is a
 * faithful stand-in for the NextRequest the App Router hands it. */
function envelope(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/lan-pair/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  calls = [];
  vi.unstubAllGlobals();
});

describe("relay lane URL composition", () => {
  it("composes the peer segment ahead of the fixed /api/config suffix on GET", async () => {
    upstreamAnswers(200, '{"video":{}}');

    const res = await POST(
      envelope({
        host: GS_HOST,
        apiKey: "gs-key",
        method: "GET",
        peerDeviceId: PEER,
      }),
    );

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${GS_HOST}/api/v1/ground-station/relay-proxy/${PEER}/api/config`,
    );
    expect(calls[0].init.method).toBe("GET");
    // The ground station's key authorises the relay hop.
    expect(
      (calls[0].init.headers as Record<string, string>)["X-ADOS-Key"],
    ).toBe("gs-key");
  });

  it("composes the same peer segment on a PUT and forwards the write body", async () => {
    upstreamAnswers(200, '{"status":"ok","key":"swarm.enabled","value":true}');

    const res = await POST(
      envelope({
        host: GS_HOST,
        apiKey: "gs-key",
        method: "PUT",
        peerDeviceId: PEER,
        body: { key: "swarm.enabled", value: "true" },
      }),
    );

    expect(res.status).toBe(200);
    expect(calls[0].url).toBe(
      `${GS_HOST}/api/v1/ground-station/relay-proxy/${PEER}/api/config`,
    );
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      key: "swarm.enabled",
      value: "true",
    });
  });

  it("leaves the LAN lane's URL untouched when no peer id is supplied", async () => {
    // The absence of the key is what distinguishes the two lanes; a LAN
    // envelope must not grow a relay prefix.
    upstreamAnswers(200, "{}");

    await POST(envelope({ host: GS_HOST, apiKey: "k", method: "GET" }));

    expect(calls[0].url).toBe(`${GS_HOST}/api/config`);
    expect(calls[0].url).not.toContain("relay-proxy");
  });

  it("gives the relay lane a longer upstream deadline than the LAN lane", async () => {
    // The ground station's own relay bound is ~10 s. A client deadline at or
    // below it turns a legitimately slow answer into a generic network error
    // instead of the agent's honest gateway timeout.
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    upstreamAnswers(200, "{}");

    await POST(envelope({ host: GS_HOST, method: "GET" }));
    const lan = timeouts.mock.calls.at(-1)?.[0];

    await POST(
      envelope({ host: GS_HOST, method: "GET", peerDeviceId: PEER }),
    );
    const relay = timeouts.mock.calls.at(-1)?.[0];

    expect(lan).toBe(12000);
    expect(relay).toBeGreaterThan(10000);
    expect(relay).toBeGreaterThan(lan as number);
    timeouts.mockRestore();
  });
});

describe("relay peer segment validation", () => {
  // Each of these could steer the upstream path if interpolated raw.
  const hostile: [string, string][] = [
    ["a dot-dot traversal", "../../../etc/passwd"],
    ["a bare dot-dot segment", ".."],
    ["a bare dot segment", "."],
    ["a slash", "drone-a/api/v1/ota/apply"],
    ["a leading slash", "/api/status/full"],
    ["a query character", "drone-a?x=1"],
    ["a fragment character", "drone-a#frag"],
    ["whitespace", "drone a"],
    ["a percent-encoded traversal", "%2e%2e%2fadmin"],
    ["a percent-encoded slash", "drone%2Fapi"],
    ["a scheme", "http://evil.example.com/"],
    ["a colon", "drone:8080"],
    ["a backslash", "drone\\api"],
    ["an over-long id", "d".repeat(33)],
  ];

  it.each(hostile)("refuses %s without building a URL", async (_label, id) => {
    upstreamAnswers(200, "{}");

    const res = await POST(
      envelope({ host: GS_HOST, method: "GET", peerDeviceId: id }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_peer_device_id");
    // The point of the guard: nothing left the server.
    expect(calls).toHaveLength(0);
  });

  it("accepts the device-id shapes the fleet actually mints", async () => {
    upstreamAnswers(200, "{}");
    for (const id of ["77735cd38937", "drone-a", "gs_1", "node.7", "A1"]) {
      await POST(
        envelope({ host: GS_HOST, method: "GET", peerDeviceId: id }),
      );
    }
    expect(calls).toHaveLength(5);
    expect(calls.map((c) => c.url)).toEqual(
      ["77735cd38937", "drone-a", "gs_1", "node.7", "A1"].map(
        (id) =>
          `${GS_HOST}/api/v1/ground-station/relay-proxy/${id}/api/config`,
      ),
    );
  });

  it("400s a relay envelope whose peer id went missing rather than calling upstream", async () => {
    // A relay envelope that lost its peer id must NOT silently downgrade to a
    // LAN call: that would read the GROUND STATION's own config and label it
    // as the drone's.
    upstreamAnswers(200, "{}");

    for (const missing of [null, "", 0, false, {}, ["drone-a"]]) {
      calls = [];
      const res = await POST(
        envelope({ host: GS_HOST, method: "GET", peerDeviceId: missing }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad_peer_device_id");
      expect(calls).toHaveLength(0);
    }
  });
});

describe("relay lane passthrough", () => {
  it("surfaces an upstream 422 verbatim, exactly as the LAN lane does", async () => {
    const payload = '{"detail":"swarm.flock.cohesion must be 0..200"}';
    upstreamAnswers(422, payload);

    const relay = await POST(
      envelope({
        host: GS_HOST,
        method: "PUT",
        peerDeviceId: PEER,
        body: { key: "swarm.flock.cohesion", value: "999" },
      }),
    );
    expect(relay.status).toBe(422);
    expect(await relay.text()).toBe(payload);

    upstreamAnswers(422, payload);
    const lan = await POST(
      envelope({
        host: GS_HOST,
        method: "PUT",
        body: { key: "swarm.flock.cohesion", value: "999" },
      }),
    );
    expect(lan.status).toBe(relay.status);
    expect(await lan.text()).toBe(payload);
  });

  it("passes an upstream {error} body through with its 200", async () => {
    upstreamAnswers(200, '{"error":"unknown key"}');

    const res = await POST(
      envelope({
        host: GS_HOST,
        method: "PUT",
        peerDeviceId: PEER,
        body: { key: "nope", value: "x" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: "unknown key" });
  });

  it("still SSRF-checks the ground station host on the relay lane", async () => {
    upstreamAnswers(200, "{}");

    const res = await POST(
      envelope({
        host: "http://93.184.216.34:8080",
        method: "GET",
        peerDeviceId: PEER,
      }),
    );

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("the client envelope and this route agree end to end", () => {
  // The one bug neither side can catch alone: the client naming the field
  // `peerId` while the route reads `peerDeviceId` would degrade every relayed
  // read into the ground station's OWN config, served with a 200. So drive the
  // real client transport into the real handler and check the composed URL.
  const reach: RelayReach = {
    baseUrl: GS_HOST,
    apiKey: "gs-key",
    peerDeviceId: PEER,
  };

  /** Route `/api/lan-pair/config` into the handler; anything else is upstream. */
  function wireClientToRoute(upstreamBody: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init: RequestInit = {}) => {
        const href = String(url);
        if (href === "/api/lan-pair/config") {
          return POST(
            new Request("http://localhost/api/lan-pair/config", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: String(init.body),
            }) as unknown as Parameters<typeof POST>[0],
          );
        }
        calls.push({ url: href, init });
        return Promise.resolve(
          new Response(upstreamBody, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );
  }

  const RELAY_URL = `${GS_HOST}/api/v1/ground-station/relay-proxy/${PEER}/api/config`;

  it("carries a relay read from the hook's transport to the drone's own /api/config", async () => {
    wireClientToRoute('{"swarm":{"enabled":false}}');

    const cfg = await getConfigViaAccess({ mode: "relay", reach });

    expect(cfg).toEqual({ swarm: { enabled: false } });
    expect(calls.map((c) => c.url)).toEqual([RELAY_URL]);
  });

  it("carries a relay write the same way", async () => {
    wireClientToRoute('{"status":"ok","key":"swarm.enabled"}');

    const res = await setConfigValueViaAccess(
      { mode: "relay", reach },
      "swarm.enabled",
      "true",
    );

    expect(res.status).toBe("ok");
    expect(calls[0].url).toBe(RELAY_URL);
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      key: "swarm.enabled",
      value: "true",
    });
  });

  it("surfaces the drone's 422 message to the hook's caller through both halves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init: RequestInit = {}) => {
        const href = String(url);
        if (href === "/api/lan-pair/config") {
          return POST(
            new Request("http://localhost/api/lan-pair/config", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: String(init.body),
            }) as unknown as Parameters<typeof POST>[0],
          );
        }
        return Promise.resolve(
          new Response('{"message":"swarm.flock.cohesion must be 0..200"}', {
            status: 422,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    await expect(
      setConfigValueViaAccess(
        { mode: "relay", reach },
        "swarm.flock.cohesion",
        "999",
      ),
    ).rejects.toThrow("swarm.flock.cohesion must be 0..200");
  });
});
