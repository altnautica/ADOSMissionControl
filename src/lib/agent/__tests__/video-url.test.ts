/**
 * @module agent/video-url.test
 * @description Regression for relative same-origin video URL resolution. The
 * agent now advertises RELATIVE media paths (`/whep`, `/whep?camera=<id>`,
 * `/hls/main/index.m3u8`) served by its own `:8080` control front — the same
 * origin this GCS reaches `/api/*` against. Consumers must resolve those
 * against the agent base, keep an absolute URL from an older agent untouched,
 * and rebuild from lastIp+port only when nothing is advertised.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  resolveAgentVideoUrl,
  resolveAgentVideoUrls,
  resolveMediaPath,
} from "../video-url";
import type { CommandCloudStatus } from "@/stores/command-fleet-store";

function status(over: Partial<CommandCloudStatus> = {}): CommandCloudStatus {
  return { deviceId: "drone-a", videoState: "running", updatedAt: 0, ...over };
}

describe("resolveMediaPath", () => {
  it("prefixes a relative path with the base", () => {
    expect(resolveMediaPath("/whep", "http://192.168.1.50:8080")).toBe(
      "http://192.168.1.50:8080/whep",
    );
  });

  it("keeps an absolute URL untouched", () => {
    expect(
      resolveMediaPath("http://drone.local:8889/main/whep", "http://192.168.1.50:8080"),
    ).toBe("http://drone.local:8889/main/whep");
  });

  it("returns null for empty input or a relative path with no base", () => {
    expect(resolveMediaPath(null, "http://x:8080")).toBeNull();
    expect(resolveMediaPath(undefined, "http://x:8080")).toBeNull();
    expect(resolveMediaPath("/whep", null)).toBeNull();
    expect(resolveMediaPath("", "http://x:8080")).toBeNull();
  });
});

describe("resolveAgentVideoUrl (WHEP)", () => {
  it("resolves a relative /whep against the agent base (lastIp)", () => {
    expect(
      resolveAgentVideoUrl(
        status({ videoWhepUrl: "/whep", lastIp: "192.168.1.50" }),
      ),
    ).toBe("http://192.168.1.50:8080/whep");
  });

  it("keeps an absolute URL from an older agent untouched", () => {
    expect(
      resolveAgentVideoUrl(
        status({
          videoWhepUrl: "http://drone.local:8889/main/whep",
          lastIp: "192.168.1.50",
        }),
      ),
    ).toBe("http://drone.local:8889/main/whep");
  });

  it("rebuilds from lastIp + port when nothing is advertised", () => {
    expect(
      resolveAgentVideoUrl(
        status({ videoWhepPort: 8889, lastIp: "192.168.1.50" }),
      ),
    ).toBe("http://192.168.1.50:8889/main/whep");
  });

  it("returns null when the node is not streaming", () => {
    expect(
      resolveAgentVideoUrl(
        status({ videoState: "stopped", videoWhepUrl: "/whep" }),
      ),
    ).toBeNull();
  });
});

describe("resolveAgentVideoUrls", () => {
  it("resolves both WHEP and HLS relative paths", () => {
    const urls = resolveAgentVideoUrls(
      status({
        videoWhepUrl: "/whep",
        videoHlsUrl: "/hls/main/index.m3u8",
        lastIp: "192.168.1.50",
      }),
    );
    expect(urls.whep).toBe("http://192.168.1.50:8080/whep");
    expect(urls.hls).toBe("http://192.168.1.50:8080/hls/main/index.m3u8");
  });

  it("resolves a per-camera WHEP query path", () => {
    expect(
      resolveAgentVideoUrl(
        status({ videoWhepUrl: "/whep?camera=ir", lastIp: "10.0.0.5" }),
      ),
    ).toBe("http://10.0.0.5:8080/whep?camera=ir");
  });

  it("leaves an absolute HLS URL untouched", () => {
    const urls = resolveAgentVideoUrls(
      status({
        videoWhepUrl: "/whep",
        videoHlsUrl: "https://relay.example.com/drone-a/index.m3u8",
        lastIp: "192.168.1.50",
      }),
    );
    expect(urls.hls).toBe("https://relay.example.com/drone-a/index.m3u8");
  });
});
