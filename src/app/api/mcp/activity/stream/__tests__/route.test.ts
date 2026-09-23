// @vitest-environment node
/**
 * The MCP activity stream serves the local tool-call log only to a
 * same-machine page, and reports `live` only once the log file exists.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "../route";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-activity-"));
  process.env.ADOS_MCP_AUDIT_PATH = join(dir, "audit.ndjson");
});

afterEach(() => {
  delete process.env.ADOS_MCP_AUDIT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const LOCAL = {
  host: "localhost:4000",
  "x-forwarded-for": "::ffff:127.0.0.1",
  "sec-fetch-site": "same-origin",
};

function get(headers: Record<string, string>): { res: Promise<Response>; abort: () => void } {
  const ctl = new AbortController();
  const req = new Request("http://localhost:4000/api/mcp/activity/stream", {
    headers,
    signal: ctl.signal,
  });
  return { res: GET(req as never), abort: () => ctl.abort() };
}

/** Read frames until the second `channel` frame (after `connecting`). */
async function channelState(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
    const states = [...text.matchAll(/event: channel\ndata: (\{.*\})/g)].map(
      (m) => (JSON.parse(m[1]) as { channel: string }).channel,
    );
    if (states.length >= 2) {
      await reader.cancel();
      return states[1];
    }
  }
  throw new Error("stream ended before a channel state");
}

describe("caller gate", () => {
  it("refuses a peer that is not loopback", async () => {
    const { res } = get({ ...LOCAL, "x-forwarded-for": "192.168.1.50" });
    expect((await res).status).toBe(403);
  });

  it("refuses a request addressed to a LAN host name", async () => {
    const { res } = get({ ...LOCAL, host: "192.168.1.50:4000" });
    expect((await res).status).toBe(403);
  });

  it("refuses a cross-site browser request", async () => {
    const { res } = get({ ...LOCAL, "sec-fetch-site": "cross-site" });
    expect((await res).status).toBe(403);
  });

  it("refuses a foreign Origin", async () => {
    const { res } = get({ ...LOCAL, origin: "http://example.com" });
    expect((await res).status).toBe(403);
  });
});

describe("channel state", () => {
  it("waits when no activity file exists", async () => {
    const { res, abort } = get(LOCAL);
    const r = await res;
    expect(r.status).toBe(200);
    expect(await channelState(r)).toBe("waiting");
    abort();
  });

  it("is live when the activity file exists", async () => {
    writeFileSync(join(dir, "audit.ndjson"), '{"tsUs":1,"tool":"x"}\n');
    const { res, abort } = get(LOCAL);
    expect(await channelState(await res)).toBe("live");
    abort();
  });
});
