// @vitest-environment node
/**
 * The registry-archive proxy fetches only release-download locations, checks
 * every redirect hop, and never buffers past its byte ceiling.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

const RELEASE =
  "https://github.com/example/plugin/releases/download/v1.0.0/plugin.adosplug";

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function get(url: string): Promise<Response> {
  return GET(
    new NextRequest(`http://localhost:4000/api/registry-archive?url=${encodeURIComponent(url)}`),
  );
}

describe("registry-archive", () => {
  it("refuses a githubusercontent host outside the release CDN", async () => {
    const res = await get("https://raw.githubusercontent.com/example/plugin/main/x");
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a github.com path that is not a release download", async () => {
    const res = await get("https://codeload.github.com/example/plugin/tar.gz/refs/heads/main");
    expect(res.status).toBe(403);
    const res2 = await get("https://github.com/example/plugin/archive/refs/heads/main.tar.gz");
    expect(res2.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at a redirect whose target is off the allowlist", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://192.168.1.50:8080/" } }),
    );
    const res = await get(RELEASE);
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
  });

  it("follows an allowlisted redirect to the release CDN", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://release-assets.githubusercontent.com/a/b" },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const res = await get(RELEASE);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses a chunked body past the ceiling without buffering it whole", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const res = await get(RELEASE);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(12);
  });
});
