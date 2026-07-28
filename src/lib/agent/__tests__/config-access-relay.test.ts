/**
 * The config surface's relay lane and its resolution precedence.
 *
 * A drone reached through a ground station's WFB relay has no direct client
 * (an HTTPS origin cannot dial the station's plain-HTTP relay-proxy from the
 * browser) and no LAN pairing record of its own (it has no IP address), so
 * before this lane existed its entire settings surface resolved `none` and
 * every page reported "Could not read the node configuration".
 *
 * Precedence is the load-bearing part: the relay is LAST, because it is the
 * only lane that crosses a radio and depends on a third node. A node with its
 * own direct path must never be routed through a relay.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConfigViaAccess,
  resolveConfigAccess,
  setConfigValueViaAccess,
  type AgentConfigClient,
  type PairingRecords,
} from "@/lib/agent/config-access";
import type { RelayReach } from "@/lib/nodes/relay-reach";
import type { LocalNode } from "@/stores/local-nodes-store";

const DRONE = "77735cd38937";

const REACH: RelayReach = {
  baseUrl: "http://192.168.1.50:8080",
  apiKey: "gs-key",
  peerDeviceId: DRONE,
};

const EMPTY: PairingRecords = { localNodes: [], pairedDrones: [] };

/** A LAN pairing record for the drone ITSELF — the lane that must beat the
 * relay, because it is one hop to the node instead of two with a radio. */
const OWN_LAN_NODE: LocalNode = {
  deviceId: DRONE,
  name: "skynode",
  hostname: "http://192.168.1.77:8080",
  apiKey: "own-key",
  profile: "drone",
  pairedAt: 1_700_000_000_000,
};

const OWN_LAN: PairingRecords = {
  localNodes: [OWN_LAN_NODE],
  pairedDrones: [],
};

const client: AgentConfigClient = {
  getConfig: vi.fn(async () => ({ video: {} })),
  setConfigValue: vi.fn(async () => ({ status: "ok" })),
};

let calls: { url: string; body: Record<string, unknown> }[] = [];

function proxyAnswers(status: number, body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
      return Promise.resolve(new Response(body, { status }));
    }),
  );
}

beforeEach(() => {
  calls = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveConfigAccess precedence", () => {
  it("prefers a direct client over everything, relay included", () => {
    const access = resolveConfigAccess(client, DRONE, OWN_LAN, REACH);
    expect(access.mode).toBe("direct");
  });

  it("never resolves a node with a direct client to the relay lane", () => {
    // The failure this guards: routing a directly-reachable drone's config
    // through its ground station's radio, adding a lossy hop for nothing.
    const access = resolveConfigAccess(client, DRONE, EMPTY, REACH);
    expect(access.mode).not.toBe("relay");
    expect(access.mode).toBe("direct");
  });

  it("prefers the node's OWN pairing record over the relay", () => {
    const access = resolveConfigAccess(null, DRONE, OWN_LAN, REACH);
    expect(access.mode).toBe("proxy");
    if (access.mode !== "proxy") throw new Error("unreachable");
    expect(access.target.host).toBe("http://192.168.1.77:8080");
    expect(access.target.apiKey).toBe("own-key");
  });

  it("falls to the relay only when there is no client and no own record", () => {
    const access = resolveConfigAccess(null, DRONE, EMPTY, REACH);
    expect(access.mode).toBe("relay");
    if (access.mode !== "relay") throw new Error("unreachable");
    expect(access.reach).toEqual(REACH);
  });

  it("still resolves none when there is no lane at all", () => {
    expect(resolveConfigAccess(null, DRONE, EMPTY).mode).toBe("none");
    expect(resolveConfigAccess(null, DRONE, EMPTY, null).mode).toBe("none");
  });

  it("keeps the pre-relay three-argument call shape working", () => {
    // `AgentNavFlatten` is editing the eventual call site concurrently; the
    // reach is a trailing optional so no existing caller changes in lockstep.
    expect(resolveConfigAccess(null, DRONE, OWN_LAN).mode).toBe("proxy");
    expect(resolveConfigAccess(client, DRONE, EMPTY).mode).toBe("direct");
  });
});

describe("relay lane transport", () => {
  it("reads config through the proxy with the ground station as host and the drone as peer", async () => {
    proxyAnswers(200, '{"video":{"wfb":{}}}');

    const cfg = await getConfigViaAccess({ mode: "relay", reach: REACH });

    expect(cfg).toEqual({ video: { wfb: {} } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/lan-pair/config");
    expect(calls[0].body).toEqual({
      host: "http://192.168.1.50:8080",
      apiKey: "gs-key",
      method: "GET",
      peerDeviceId: DRONE,
    });
  });

  it("writes a single key through the proxy with the peer segment attached", async () => {
    proxyAnswers(200, '{"status":"ok","key":"swarm.enabled"}');

    const res = await setConfigValueViaAccess(
      { mode: "relay", reach: REACH },
      "swarm.enabled",
      "true",
    );

    expect(res.status).toBe("ok");
    expect(calls[0].body).toEqual({
      host: "http://192.168.1.50:8080",
      apiKey: "gs-key",
      method: "PUT",
      peerDeviceId: DRONE,
      body: { key: "swarm.enabled", value: "true" },
    });
  });

  it("never sends a peerDeviceId on the LAN proxy lane", async () => {
    // The key IS the lane discriminator server-side, so a stray one on a LAN
    // envelope would send the call at a relay-proxy path the host does not run.
    proxyAnswers(200, "{}");

    await getConfigViaAccess({
      mode: "proxy",
      target: { host: "http://192.168.1.77:8080", apiKey: "own-key" },
    });

    expect(calls[0].body).not.toHaveProperty("peerDeviceId");
  });

  it("surfaces an upstream 422 message verbatim, exactly as the proxy lane does", async () => {
    const detail = '{"message":"swarm.flock.cohesion must be 0..200"}';

    proxyAnswers(422, detail);
    await expect(
      setConfigValueViaAccess(
        { mode: "relay", reach: REACH },
        "swarm.flock.cohesion",
        "999",
      ),
    ).rejects.toThrow("swarm.flock.cohesion must be 0..200");

    proxyAnswers(422, detail);
    await expect(
      setConfigValueViaAccess(
        {
          mode: "proxy",
          target: { host: "http://192.168.1.77:8080", apiKey: "own-key" },
        },
        "swarm.flock.cohesion",
        "999",
      ),
    ).rejects.toThrow("swarm.flock.cohesion must be 0..200");
  });

  it("keeps the caller's {error} check working on a 2xx relay answer", async () => {
    proxyAnswers(200, '{"error":"unknown key"}');
    const res = await setConfigValueViaAccess(
      { mode: "relay", reach: REACH },
      "nope",
      "x",
    );
    expect(res.error).toBe("unknown key");
  });

  it("rejects a malformed relay payload rather than returning a fabricated config", async () => {
    proxyAnswers(200, "[1,2,3]");
    await expect(
      getConfigViaAccess({ mode: "relay", reach: REACH }),
    ).rejects.toThrow(/malformed configuration/i);
  });
});
