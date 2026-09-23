// @vitest-environment node
/**
 * The local MAVLink WebSocket bridges admit a client only when it presents
 * the per-run token as `?token=` and, if it is a browser page, comes from a
 * loopback origin or one the operator allowed. A WebSocket is not CORS-gated,
 * so without this any web page the operator opened could arm the vehicle.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { once } from "node:events";
import WebSocket from "ws";
import { TcpWsBridge } from "../../../tools/mavlink-bridge/src/tcp-ws";
import { TcpWsBridge as SitlBridge } from "../../../tools/sitl/src/bridge/tcp-ws";
import { staleCopies } from "../../../scripts/sync-bridge-shared.mjs";

const TOKEN = "per-run-token";

async function freeTcpPort(host: string): Promise<number> {
  const srv = net.createServer().listen(0, host);
  await once(srv, "listening");
  const addr = srv.address();
  srv.close();
  if (!addr || typeof addr === "string") throw new Error("expected an inet address");
  return addr.port;
}

/** Dial a bridge; resolves "open" or the HTTP status the upgrade was refused with. */
function dial(url: string, origin?: string): Promise<"open" | number> {
  const { promise, resolve } = Promise.withResolvers<"open" | number>();
  const ws = new WebSocket(url, origin ? { origin } : {});
  ws.on("open", () => {
    ws.close();
    resolve("open");
  });
  ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
  ws.on("error", () => resolve(-1));
  return promise;
}

describe("mavlink-bridge WebSocket admission", () => {
  let bridge: TcpWsBridge | null = null;

  afterEach(() => {
    bridge?.shutdown();
    bridge = null;
  });

  async function start(): Promise<string> {
    const wsPort = await freeTcpPort("127.0.0.1");
    // The TCP side points at a closed port; admission does not depend on it.
    const deadPort = await freeTcpPort("127.0.0.1");
    bridge = new TcpWsBridge({
      wsPort,
      wsHost: "127.0.0.1",
      token: TOKEN,
      allowedOrigins: ["https://gcs.example.com"],
      host: "127.0.0.1",
      port: deadPort,
    });
    bridge.on("error", () => {});
    bridge.start();
    return `ws://127.0.0.1:${wsPort}/`;
  }

  it("refuses a page from a foreign origin even with the right token", async () => {
    const base = await start();
    expect(await dial(`${base}?token=${TOKEN}`, "https://evil.example.org")).toBe(403);
  });

  it("refuses a missing or wrong token", async () => {
    const base = await start();
    expect(await dial(base)).toBe(401);
    expect(await dial(`${base}?token=wrong`, "http://localhost:4000")).toBe(401);
  });

  it("accepts the right token from a CLI client, a loopback page and an allowed origin", async () => {
    const base = await start();
    expect(await dial(`${base}?token=${TOKEN}`)).toBe("open");
    expect(await dial(`${base}?token=${TOKEN}`, "http://localhost:4000")).toBe("open");
    expect(await dial(`${base}?token=${TOKEN}`, "https://gcs.example.com")).toBe("open");
  });
});

describe("SITL bridge WebSocket admission", () => {
  let bridge: SitlBridge | null = null;

  afterEach(() => {
    bridge?.shutdown();
    bridge = null;
  });

  it("requires the token and a loopback origin", async () => {
    const port = await freeTcpPort("::1");
    bridge = new SitlBridge({
      wsPort: port,
      wsHost: "::1",
      token: TOKEN,
      tcpInstances: [{ host: "127.0.0.1", port, sysId: 1 }],
    });
    bridge.on("error", () => {});
    bridge.start();
    const base = `ws://[::1]:${port}/`;

    expect(await dial(base)).toBe(401);
    expect(await dial(`${base}?token=${TOKEN}`, "https://evil.example.org")).toBe(403);
    expect(await dial(`${base}?token=${TOKEN}`, "http://[::1]:4000")).toBe("open");
  });
});

describe("bridge shared modules", () => {
  it("keeps every generated copy identical to its source", () => {
    expect(staleCopies()).toEqual([]);
  });
});
