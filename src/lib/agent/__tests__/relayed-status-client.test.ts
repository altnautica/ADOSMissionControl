/**
 * @license GPL-3.0-only
 *
 * Tests for the relayed-status response parser: the pure, defensive half of
 * `fetchRelayedStatus`. Exercised via the module's internal parse path by
 * mocking `fetch` on the direct (HTTP) branch, so no server or agent is
 * needed — the SSRF-checked proxy route is a separate, thin pass-through
 * tested by its own route conventions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchRelayedStatus } from "../relayed-status-client";

const originalLocation = window.location;

function setProtocol(protocol: "http:" | "https:") {
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, protocol },
    writable: true,
  });
}

describe("fetchRelayedStatus", () => {
  beforeEach(() => {
    setProtocol("http:");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
  });

  it("parses a fresh peer's compact status into the typed shape", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          peers: [
            {
              device_id: "drone-a",
              name: "Agent drone-a",
              profile: "drone",
              agent_version: "0.99.244",
              status_fresh: true,
              status_age_s: 1.2,
              status: {
                fc: true,
                fa: true,
                fv: "ardupilot",
                ff: "ardupilot",
                sr: 25,
                sf: 0,
                so: 3,
                sn: ["ados-vision"],
                cp: 42.1,
                mp: 55.0,
                dp: 30.0,
                tc: 47.5,
                bn: "Radxa Cubie A7S",
                bs: "Allwinner A733",
                bt: 3,
                up: 600,
                ver: "0.99.244",
                cs: "ready",
                vs: "running",
              },
            },
          ],
          peer_count: 1,
          generated_at_unix: 1_700_000_000,
        }),
        { status: 200 },
      ),
    );

    const out = await fetchRelayedStatus("192.168.1.50", "key-1");
    expect(out.peerCount).toBe(1);
    expect(out.peers).toHaveLength(1);
    const p = out.peers[0];
    expect(p.deviceId).toBe("drone-a");
    expect(p.statusFresh).toBe(true);
    expect(p.status?.fcConnected).toBe(true);
    expect(p.status?.mavlinkAlive).toBe(true);
    expect(p.status?.fcVariant).toBe("ardupilot");
    expect(p.status?.servicesRunning).toBe(25);
    expect(p.status?.servicesFailed).toBe(0);
    expect(p.status?.failedServiceNames).toEqual(["ados-vision"]);
    expect(p.status?.cpuPercent).toBe(42.1);
    expect(p.status?.boardName).toBe("Radxa Cubie A7S");
    expect(p.status?.boardTier).toBe(3);
  });

  it("drops the status block when status_fresh is false, even if one is present", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          peers: [
            {
              device_id: "drone-a",
              status_fresh: false,
              status_age_s: 45,
              status: { cp: 99 },
            },
          ],
          peer_count: 1,
          generated_at_unix: 1_700_000_000,
        }),
        { status: 200 },
      ),
    );
    const out = await fetchRelayedStatus("192.168.1.50", "key-1");
    expect(out.peers[0].statusFresh).toBe(false);
    expect(out.peers[0].status).toBeUndefined();
  });

  it("drops a peer entry with no device id rather than guessing one", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ peers: [{ status_fresh: true }, { device_id: "drone-a" }] }),
        { status: 200 },
      ),
    );
    const out = await fetchRelayedStatus("192.168.1.50", null);
    expect(out.peers.map((p) => p.deviceId)).toEqual(["drone-a"]);
  });

  it("returns the empty response on a 404 (no relay running) rather than throwing", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 404 }));
    const out = await fetchRelayedStatus("192.168.1.50", "key-1");
    expect(out).toEqual({ peers: [], peerCount: 0, generatedAtUnix: 0 });
  });

  it("returns the empty response on a network failure rather than throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const out = await fetchRelayedStatus("192.168.1.50", "key-1");
    expect(out.peers).toEqual([]);
  });

  it("returns the empty response on a malformed JSON body", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not json", { status: 200 }));
    const out = await fetchRelayedStatus("192.168.1.50", "key-1");
    expect(out.peers).toEqual([]);
  });

  it("sends the API key as X-ADOS-Key on the direct HTTP path", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ peers: [] }), { status: 200 }),
    );
    await fetchRelayedStatus("192.168.1.50", "secret-key");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain(
      "192.168.1.50:8080/api/v1/ground-station/relayed/status",
    );
    expect((init?.headers as Record<string, string>)["X-ADOS-Key"]).toBe(
      "secret-key",
    );
  });

  it("routes through the lan-pair proxy on an HTTPS origin instead of dialing the agent directly", async () => {
    setProtocol("https:");
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ peers: [] }), { status: 200 }),
    );
    await fetchRelayedStatus("192.168.1.50", "secret-key");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("/api/lan-pair/relayed-status");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ host: "192.168.1.50", apiKey: "secret-key" });
  });
});
