// @vitest-environment node
/**
 * The LAN-pair proxy core: who may call a proxy route, which agent it may
 * reach, which paths it may name, and what the GCS origin answers with.
 *
 * Every refusal must happen before any upstream fetch, and every answer must
 * be `application/json`, so an agent (or anything posing as one) can never
 * serve a document that runs on the GCS origin.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock("node:dns", () => ({
  default: { promises: { lookup } },
  promises: { lookup },
}));

import { POST as atlasPost } from "../atlas/route";
import { POST as computePost } from "../compute/route";
import { POST as probePost } from "../probe/route";
import { POST as artifactPost, GET as artifactGet } from "../artifact/route";
import { POST as visionUploadPost } from "../vision-upload/route";

const ORIGIN = "http://localhost:4000";

type Handler = (req: never) => Promise<Response>;

function call(
  handler: Handler,
  payload: unknown,
  headers: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
  },
): Promise<Response> {
  const req = new Request("http://localhost:4000/api/lan-pair/x", {
    method: "POST",
    headers: { host: "localhost:4000", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return handler(req as never);
}

let fetchMock: Mock;

function upstream(body: string, init: ResponseInit = {}) {
  fetchMock.mockResolvedValueOnce(new Response(body, init));
}

beforeEach(() => {
  lookup.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ATLAS = { host: "192.168.1.50", apiKey: "k", path: "readiness" };

describe("caller gate", () => {
  it("refuses a request with no Origin", async () => {
    const res = await call(atlasPost, ATLAS, {
      "content-type": "application/json",
    });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-site Origin", async () => {
    const res = await call(atlasPost, ATLAS, {
      "content-type": "application/json",
      origin: "https://evil.example.com",
    });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a text/plain body that a cross-site form could send", async () => {
    const res = await call(atlasPost, ATLAS, {
      "content-type": "text/plain",
      origin: ORIGIN,
    });
    expect(res.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a grant cookie mint from another site", async () => {
    const res = await call(
      artifactPost,
      { host: "192.168.1.50:8092", key: "k" },
      { "content-type": "application/json", origin: "https://evil.example.com" },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("target gate", () => {
  it("refuses a public host", async () => {
    const res = await call(atlasPost, { ...ATLAS, host: "8.8.8.8" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a private host on a port that is not the agent's", async () => {
    const res = await call(atlasPost, { ...ATLAS, host: "172.18.0.2:3210" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("port_not_allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a .local name that does not resolve to a private address", async () => {
    lookup.mockResolvedValue({ address: "203.0.113.9", family: 4 });
    const res = await call(atlasPost, { ...ATLAS, host: "drone.local" });
    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("path gate", () => {
  it.each([
    ["%2e%2e/%2e%2e/x"],
    [".%2e/x"],
    ["../x"],
    ["./readiness"],
    ["capture//start"],
    ["capture/"],
    ["readiness?x=1"],
    [""],
  ])("refuses atlas path %j", async (path) => {
    const res = await call(atlasPost, { ...ATLAS, path });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an encoded traversal on the compute proxy", async () => {
    const res = await call(computePost, {
      host: "192.168.1.50",
      path: "%2e%2e/%2e%2e/api/config",
    });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an artifact path that leaves artifacts/", async () => {
    const res = await artifactGet(
      new NextRequest(
        "http://localhost:4000/api/lan-pair/artifact?host=192.168.1.50:8092&path=artifacts/%252e%252e/x",
      ),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a plain sub-path under the fixed prefix", async () => {
    upstream('{"ready":true}', { status: 200 });
    const res = await call(atlasPost, { ...ATLAS, path: "capture/start", method: "POST" });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://192.168.1.50:8080/api/atlas/capture/start");
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["X-ADOS-Key"]).toBe("k");
  });
});

describe("response", () => {
  it("passes a JSON body and status through with fixed JSON headers", async () => {
    upstream('{"error":"capture service down"}', {
      status: 503,
      headers: { "content-type": "application/json" },
    });
    const res = await call(atlasPost, ATLAS);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "capture service down" });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("never relays a non-JSON upstream body or its content type", async () => {
    upstream("<script>alert(1)</script>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const res = await call(probePost, { host: "192.168.1.50" });
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe("application/json");
    const text = await res.text();
    expect(text).not.toContain("<script>");
    expect(JSON.parse(text).error).toBe("upstream_not_json");
  });

  it("keeps a non-JSON error status but replaces the body", async () => {
    upstream("<html>nope</html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    });
    const res = await call(atlasPost, ATLAS);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).not.toContain("<html>");
  });

  it("does not follow an upstream redirect", async () => {
    upstream("", { status: 302, headers: { location: "http://10.0.0.1:2375/" } });
    const res = await call(atlasPost, ATLAS);
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("model upload body bound", () => {
  function uploadForm(): FormData {
    const form = new FormData();
    form.append("host", "192.168.1.50");
    form.append("apiKey", "k");
    form.append("file", new File([new Uint8Array(16)], "m.onnx"));
    form.append("metadata", "{}");
    return form;
  }

  async function upload(length: string | null): Promise<Response> {
    const encoded = new Request("http://localhost:4000/x", {
      method: "POST",
      body: uploadForm(),
    });
    const body = await encoded.arrayBuffer();
    const headers: Record<string, string> = {
      host: "localhost:4000",
      origin: ORIGIN,
      "content-type": encoded.headers.get("content-type") ?? "",
    };
    if (length !== null) headers["content-length"] = length;
    const req = new Request("http://localhost:4000/api/lan-pair/vision-upload", {
      method: "POST",
      headers,
      body,
    });
    return visionUploadPost(req as never);
  }

  it("refuses a declared length over the ceiling before reading the body", async () => {
    const res = await upload(String(4 * 1024 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a body with no declared length", async () => {
    const res = await upload(null);
    expect(res.status).toBe(411);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards an upload inside the ceiling", async () => {
    upstream('{"status":"ok"}', { status: 200 });
    const res = await upload("1024");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
