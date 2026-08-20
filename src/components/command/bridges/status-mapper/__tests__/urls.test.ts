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

  it("resolves the HLS fallback the same way", () => {
    const { hlsUrl } = resolveVideoUrls(
      {
        videoState: "running",
        videoWhepUrl: "/whep",
        videoHlsUrl: "/hls/main/index.m3u8",
        lastIp: "192.168.1.50",
      },
      null,
    );
    expect(hlsUrl).toBe("http://192.168.1.50:8080/hls/main/index.m3u8");
  });

  it("keeps an absolute URL from an older agent (optionally .local-swapped)", () => {
    const { whepUrl } = resolveVideoUrls(
      {
        videoState: "running",
        videoWhepUrl: "http://drone.local:8889/main/whep",
        lastIp: "10.0.0.5",
      },
      null,
    );
    expect(whepUrl).toBe("http://10.0.0.5:8889/main/whep");
  });
});

describe("resolveVideoStreams — per-leg relative resolution", () => {
  it("resolves per-leg relative whep + hls against the agent base", () => {
    const legs = resolveVideoStreams(
      {
        videoState: "running",
        lastIp: "192.168.1.50",
        videoStreams: [
          { id: "ir", whep: "/whep?camera=ir", hls: "/hls/ir/index.m3u8" },
        ],
      },
      null,
    );
    expect(legs).toEqual([
      expect.objectContaining({
        id: "ir",
        whepUrl: "http://192.168.1.50:8080/whep?camera=ir",
        hlsUrl: "http://192.168.1.50:8080/hls/ir/index.m3u8",
      }),
    ]);
  });

  it("rebuilds the legacy per-leg URL form when no whep is advertised", () => {
    const legs = resolveVideoStreams(
      {
        videoState: "running",
        lastIp: "192.168.1.50",
        videoStreams: [{ id: "ir" }],
      },
      null,
    );
    expect(legs[0].whepUrl).toBe("http://192.168.1.50:8889/ir/whep");
    expect(legs[0].hlsUrl).toBeUndefined();
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
