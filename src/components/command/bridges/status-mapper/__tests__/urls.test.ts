/**
 * @license GPL-3.0-only
 *
 * Unit tests for resolveMavlinkUrl: the raw-proxy URL precedence
 * (heartbeat URL → port+lastIp → LAN-host default 8765) plus the
 * `.local` → IPv4 swap. The cascade dials this single URL for any
 * profile and attaches a ticket when a pairing key is held, so there
 * is no separate authenticated endpoint to resolve.
 */

import { describe, it, expect } from "vitest";
import { resolveMavlinkUrl, resolveVideoUrls, resolveVideoStreams } from "../urls";

describe("resolveVideoUrls — relative same-origin resolution", () => {
  it("prefixes a relative /whep against the agent base (lastIp)", () => {
    const { state, whepUrl } = resolveVideoUrls(
      { videoState: "running", videoWhepUrl: "/whep", lastIp: "192.168.1.50" },
      null,
    );
    expect(state).toBe("running");
    expect(whepUrl).toBe("http://192.168.1.50:8080/whep");
  });

  it("resolves no HLS URL — nothing in this app can play a playlist", () => {
    const urls = resolveVideoUrls(
      {
        videoState: "running",
        videoWhepUrl: "/whep",
        videoHlsUrl: "/hls/main/index.m3u8",
        lastIp: "192.168.1.50",
      },
      null,
    );
    expect(urls.whepUrl).toBe("http://192.168.1.50:8080/whep");
    expect("hlsUrl" in urls).toBe(false);
  });

  it("keeps an absolute advertised URL, swapping a .local host for the IPv4", () => {
    const { whepUrl } = resolveVideoUrls(
      {
        videoState: "running",
        videoWhepUrl: "http://drone.local:8080/whep",
        lastIp: "10.0.0.5",
      },
      null,
    );
    expect(whepUrl).toBe("http://10.0.0.5:8080/whep");
  });

  it("never synthesizes a mediamtx URL when the node advertises none", () => {
    // mediamtx's WHEP port is loopback-only on the node; only the :8080 front
    // is reachable and authenticated.
    const { whepUrl } = resolveVideoUrls(
      { videoState: "running", videoWhepPort: 8889, lastIp: "10.0.0.5" },
      "10.0.0.5",
    );
    expect(whepUrl).toBeNull();
  });
});

describe("resolveVideoStreams — per-leg relative resolution", () => {
  it("resolves the per-leg relative whep against the agent base, and no hls", () => {
    const legs = resolveVideoStreams(
      {
        videoState: "running",
        lastIp: "192.168.1.50",
        videoStreams: [
          { id: "ir", whep: "/whep?camera=ir", hls: "/hls/ir/index.m3u8" },
        ],
      },
    );
    expect(legs).toEqual([
      {
        id: "ir",
        role: undefined,
        codec: undefined,
        live: undefined,
        whepUrl: "http://192.168.1.50:8080/whep?camera=ir",
      },
    ]);
  });

  it("leaves out a leg the node advertised no path for", () => {
    const legs = resolveVideoStreams({
      videoState: "running",
      lastIp: "192.168.1.50",
      videoStreams: [{ id: "ir" }, { id: "eo", whep: "/whep?camera=eo" }],
    });
    expect(legs.map((l) => l.whepUrl)).toEqual(["http://192.168.1.50:8080/whep?camera=eo"]);
  });
});



describe("resolveMavlinkUrl — raw proxy URL", () => {
  it("prefers the heartbeat-published URL", () => {
    const { url } = resolveMavlinkUrl(
      { mavlinkWsUrl: "ws://10.0.0.5:8765/", lastIp: "10.0.0.5" },
      "drone.local",
    );
    expect(url).toBe("ws://10.0.0.5:8765/");
  });

  it("swaps a .local heartbeat host for the known IPv4", () => {
    const { url } = resolveMavlinkUrl(
      { mavlinkWsUrl: "ws://drone.local:8765/", lastIp: "10.0.0.5" },
      "drone.local",
    );
    expect(url).toBe("ws://10.0.0.5:8765/");
  });

  it("falls back to a port hint + lastIp", () => {
    const { url } = resolveMavlinkUrl(
      { mavlinkWsPort: 9000, lastIp: "10.0.0.5" },
      "drone.local",
    );
    expect(url).toBe("ws://10.0.0.5:9000/");
  });

  it("falls back to the LAN-host default port 8765", () => {
    const { url } = resolveMavlinkUrl({}, "drone.local");
    expect(url).toBe("ws://drone.local:8765/");
  });

  it("returns null when there is no host to derive from", () => {
    const { url } = resolveMavlinkUrl({}, null);
    expect(url).toBeNull();
  });
});
