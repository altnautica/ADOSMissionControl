/**
 * Tests for the profile-agnostic agent Wi-Fi client: header/key handling,
 * shape normalisation (unknown stays null, never guessed), the
 * join-refused-while-AP-active conflict surfacing as `needsForce`, and the
 * unexposed-route detection the scan UI uses for its honest message.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentNetworkError,
  agentNetworkContext,
  forgetWifi,
  getConfiguredWifi,
  getWifiStatus,
  isRouteUnexposed,
  joinWifi,
  scanWifi,
  setWifiAutoconnect,
} from "@/lib/agent/network-client";

const CTX = { baseUrl: "http://node.local:8080", apiKey: "KEY" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stub(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("agentNetworkContext", () => {
  it("returns null without an agent URL and trims trailing slashes", () => {
    expect(agentNetworkContext(null, "KEY")).toBeNull();
    expect(agentNetworkContext("http://node.local:8080/", "KEY")).toEqual({
      baseUrl: "http://node.local:8080",
      apiKey: "KEY",
    });
  });
});

describe("getWifiStatus", () => {
  it("sends the pairing key and normalises the reported shape", async () => {
    const fetchMock = stub(200, {
      connected: true,
      ssid: "BenchNet",
      bssid: "AA:BB:CC:DD:EE:FF",
      signal: 72,
      ip: "192.168.7.42",
      gateway: "192.168.7.1",
      security: "WPA2",
    });

    const status = await getWifiStatus(CTX);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://node.local:8080/api/v1/network/client/status",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-ADOS-Key": "KEY" }),
      }),
    );
    expect(status).toEqual({
      connected: true,
      ssid: "BenchNet",
      bssid: "AA:BB:CC:DD:EE:FF",
      signal: 72,
      ip: "192.168.7.42",
      gateway: "192.168.7.1",
      security: "WPA2",
    });
  });

  it("keeps unknown fields null instead of fabricating values", async () => {
    stub(200, { connected: false });
    const status = await getWifiStatus(CTX);
    expect(status).toEqual({
      connected: false,
      ssid: null,
      bssid: null,
      signal: null,
      ip: null,
      gateway: null,
      security: null,
    });
  });
});

describe("joinWifi", () => {
  it("PUTs the ssid + passphrase and omits an empty passphrase", async () => {
    const fetchMock = stub(200, { joined: true, ip: "10.0.0.9", gateway: null });

    const res = await joinWifi(CTX, { ssid: "BenchNet", passphrase: "secret" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://node.local:8080/api/v1/network/client/join");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      ssid: "BenchNet",
      passphrase: "secret",
    });
    expect(res).toEqual({
      joined: true,
      ip: "10.0.0.9",
      gateway: null,
      error: null,
    });

    fetchMock.mockClear();
    await joinWifi(CTX, { ssid: "Open", passphrase: "" });
    const [, openInit] = fetchMock.mock.calls[0];
    expect(JSON.parse(openInit?.body as string)).toEqual({ ssid: "Open" });
  });

  it("surfaces the AP-busy conflict as needsForce with the agent's message", async () => {
    stub(409, {
      detail: {
        error: {
          code: "E_WLAN0_BUSY_AP_ACTIVE",
          message: "AP is active; retry with force=true to steal wlan0",
        },
      },
      needs_force: true,
    });

    const err = await joinWifi(CTX, { ssid: "BenchNet" }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentNetworkError);
    expect((err as AgentNetworkError).needsForce).toBe(true);
    expect((err as AgentNetworkError).code).toBe("E_WLAN0_BUSY_AP_ACTIVE");
    expect((err as AgentNetworkError).message).toMatch(/AP is active/);
  });
});

describe("scanWifi", () => {
  it("returns the reported networks and drops malformed rows", async () => {
    stub(200, {
      networks: [
        { ssid: "A", bssid: "aa", signal: 80, security: "WPA2", in_use: true },
        { ssid: "", bssid: "bb", signal: 10, security: "" },
        "garbage",
      ],
    });
    const nets = await scanWifi(CTX);
    expect(nets).toEqual([
      { ssid: "A", bssid: "aa", signal: 80, security: "WPA2", in_use: true },
    ]);
  });

  it("distinguishes an unexposed route from a failed scan", async () => {
    stub(404, { detail: "Not Found" });
    const notFound = await scanWifi(CTX).catch((e) => e);
    expect(isRouteUnexposed(notFound)).toBe(true);

    stub(500, {
      detail: { error: { code: "E_WIFI_SCAN_FAILED", message: "nmcli failed" } },
    });
    const failed = await scanWifi(CTX).catch((e) => e);
    expect(isRouteUnexposed(failed)).toBe(false);
    expect((failed as AgentNetworkError).message).toBe("nmcli failed");
  });
});

describe("saved-network operations", () => {
  it("normalises the configured list", async () => {
    stub(200, {
      connections: [
        { name: "BenchNet", type: "802-11-wireless", device: "wlan0", autoconnect: true },
        { name: "Saved", type: "802-11-wireless", device: null, autoconnect: false },
        { type: "802-11-wireless" },
      ],
    });
    expect(await getConfiguredWifi(CTX)).toEqual([
      { name: "BenchNet", type: "802-11-wireless", device: "wlan0", autoconnect: true },
      { name: "Saved", type: "802-11-wireless", device: null, autoconnect: false },
    ]);
  });

  it("URL-encodes the profile name on forget and autoconnect", async () => {
    const fetchMock = stub(200, { forgot: true, name: "My Net", error: null });
    await forgetWifi(CTX, "My Net");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://node.local:8080/api/v1/network/client/configured/My%20Net",
    );

    fetchMock.mockClear();
    await setWifiAutoconnect(CTX, "My Net", true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "http://node.local:8080/api/v1/network/client/configured/My%20Net/autoconnect",
    );
    expect(JSON.parse(init?.body as string)).toEqual({ enabled: true });
  });
});
