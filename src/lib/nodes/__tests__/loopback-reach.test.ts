/**
 * @module nodes/__tests__/loopback-reach-behaviour
 * @description The two decisions a loopback reach changes: the secure-page
 * block does not apply to it, and a pair call to it must not go through the
 * server-side proxy (which would dial `127.0.0.1` on our own server).
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lanBlockedOnSecurePage } from "../local-reach";
import { shouldUseProxy } from "../../agent/local-pair/transport";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

const LOOPBACK_NODE = {
  deviceId: "loopback-1",
  name: "This computer",
  hostname: "http://127.0.0.1:8080",
  apiKey: "k",
  profile: "ground-station" as const,
  pairedAt: 0,
};

const LAN_NODE = {
  deviceId: "lan-1",
  name: "Skynode",
  hostname: "http://192.168.1.50:8080",
  apiKey: "k",
  profile: "ground-station" as const,
  pairedAt: 0,
};

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [LOOPBACK_NODE, LAN_NODE] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lanBlockedOnSecurePage", () => {
  it("does not block a loopback node on an https page", () => {
    // Loopback is exempt from the mixed-content rule, so the hosted GCS reaches
    // this node. Blocking it would hide a ground station that works.
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    expect(lanBlockedOnSecurePage("loopback-1", [])).toBe(false);
  });

  it("still blocks a LAN-only node on an https page", () => {
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    expect(lanBlockedOnSecurePage("lan-1", [])).toBe(true);
  });

  it("does not block anything on an http page", () => {
    vi.stubGlobal("window", { location: { protocol: "http:" } });
    expect(lanBlockedOnSecurePage("lan-1", [])).toBe(false);
  });
});

describe("shouldUseProxy", () => {
  it("never proxies a loopback host", () => {
    // The proxy runs on Mission Control's own server; forwarding 127.0.0.1
    // there would have it dial itself.
    vi.stubGlobal("window", {});
    expect(shouldUseProxy("http://127.0.0.1:8080")).toBe(false);
    expect(shouldUseProxy("http://localhost:8080")).toBe(false);
  });

  it("proxies a LAN host from a window", () => {
    vi.stubGlobal("window", {});
    expect(shouldUseProxy("http://192.168.1.50:8080")).toBe(true);
  });

  it("fetches directly with no window at all", () => {
    // Server-side renderers have no proxy to call: `fetch` runs in-process.
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
    expect(shouldUseProxy("http://192.168.1.50:8080")).toBe(false);
  });
});
