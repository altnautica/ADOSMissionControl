/**
 * @module api/mcp/activity/stream
 * @description Server-Sent Events tail of the local MCP server's activity files.
 * The MCP server (a separate process on the operator's OWN machine) appends one
 * JSON line per tool call to `~/.ados/mcp/audit.ndjson` (and, when the running
 * lane is enabled, `~/.ados/mcp/activity.ndjson`). This route streams each new
 * line to a same-machine Mission Control so the browser can watch the MCP work
 * live. It is LOCAL-FIRST by construction: it reads a file on the machine the
 * GCS server runs on — nothing here reaches the network or the cloud. When the
 * GCS is hosted (a different machine), the file simply does not exist and the
 * route emits a `waiting` frame; the client also gates on cloud-mode and does
 * not open the stream there.
 *
 * The feed carries every tool name and argument the MCP handled, so it is served
 * only to a same-machine browser: the peer address must be loopback, the page
 * must have been addressed by a loopback host name, and a browser request must
 * come from this origin. `next dev` / `next start` listen on every interface,
 * so without these checks any host on the network could tail the log.
 * @license GPL-3.0-only
 */

import type { NextRequest } from "next/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { open, stat } from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 500;
const HEARTBEAT_MS = 15_000;
const BACKLOG_BYTES = 128 * 1024;
const BACKLOG_LINES = 100;
/** Most bytes read in one poll; a burst larger than this drains over later polls. */
const MAX_POLL_BYTES = 256 * 1024;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for a loopback peer address as Node reports it (IPv4, IPv6 or mapped). */
function isLoopbackAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase();
  return a === "::1" || /^(::ffff:)?127\.\d+\.\d+\.\d+$/.test(a);
}

/** Refuse anything but a same-machine browser page on this origin.
 *
 *  - Peer: Next fills `x-forwarded-for` from the socket's remote address; a
 *    LAN caller reaching the server directly carries its own address there.
 *    Every hop listed must be loopback.
 *  - Host: the page must have been loaded from a loopback name, so a request
 *    addressed to the machine's LAN address is refused.
 *  - Origin: a browser marks a cross-site subresource with `Sec-Fetch-Site`,
 *    and a cross-origin request carries `Origin`; either must name this site. */
function refuseNonLocal(request: Request): Response | null {
  const peers = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (peers.length === 0 || !peers.every(isLoopbackAddress)) {
    return new Response("forbidden", { status: 403 });
  }
  const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!LOOPBACK_HOSTS.has(host)) {
    return new Response("forbidden", { status: 403 });
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return new Response("forbidden", { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      /* unparseable origin is refused below */
    }
    if (originHost !== (request.headers.get("host") ?? "").toLowerCase()) {
      return new Response("forbidden", { status: 403 });
    }
  }
  return null;
}

/** The single file to tail: prefer the richer running-lifecycle activity.ndjson
 *  when the MCP writes it, else the completed-only audit.ndjson. Tailing one
 *  file avoids double-counting a completion that lands in both. */
async function pickActivityFile(): Promise<string> {
  const override = process.env.ADOS_MCP_AUDIT_PATH?.trim();
  const dir = override ? override.replace(/\/audit\.ndjson$/, "") : join(homedir(), ".ados", "mcp");
  const activity = join(dir, "activity.ndjson");
  try {
    await stat(activity);
    return activity;
  } catch {
    return join(dir, "audit.ndjson");
  }
}

/** Read up to the last `maxBytes` of a file and return its complete trailing
 *  lines (newest last), plus the byte offset now consumed. Missing file -> null. */
async function readTail(
  path: string,
  maxBytes: number,
): Promise<{ lines: string[]; offset: number } | null> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch {
    return null;
  }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return { lines: [], offset: size };
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    const text = buf.toString("utf8");
    // If we started mid-file, drop the first partial line.
    const all = text.split("\n");
    const lines = (start > 0 ? all.slice(1) : all).map((l) => l.trim()).filter(Boolean);
    return { lines, offset: size };
  } finally {
    await fh.close();
  }
}

/** Read the bytes appended since `offset` (at most `MAX_POLL_BYTES` per call);
 *  returns complete lines + new offset. A shrunk file (rotation/truncation)
 *  resets to 0. Missing file -> null. */
async function readSince(
  path: string,
  offset: number,
  remainder: string,
): Promise<{ lines: string[]; offset: number; remainder: string } | null> {
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch {
    return null;
  }
  if (size < offset) offset = 0; // rotated/truncated — re-read from the top
  if (size === offset) return { lines: [], offset, remainder };
  const fh = await open(path, "r");
  try {
    const len = Math.min(size - offset, MAX_POLL_BYTES);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, offset);
    const text = remainder + buf.subarray(0, bytesRead).toString("utf8");
    const parts = text.split("\n");
    // A single line longer than the poll budget is dropped rather than held.
    const pending = parts.pop() ?? "";
    const nextRemainder = pending.length > MAX_POLL_BYTES ? "" : pending;
    const lines = parts.map((l) => l.trim()).filter(Boolean);
    return { lines, offset: offset + bytesRead, remainder: nextRemainder };
  } finally {
    await fh.close();
  }
}

export async function GET(request: NextRequest) {
  const refused = refuseNonLocal(request);
  if (refused) return refused;
  const files = [await pickActivityFile()];
  const offsets = new Map<string, number>();
  const remainders = new Map<string, string>();
  let fileSeen = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          closed = true;
        }
      };
      const comment = () => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      };

      send("channel", JSON.stringify({ channel: "connecting" }));

      // Backlog: seed the newest lines from whatever files exist, ordered by
      // time so the feed opens already populated.
      const backlog: { ts: number; line: string }[] = [];
      for (const path of files) {
        const tail = await readTail(path, BACKLOG_BYTES);
        if (tail) {
          fileSeen = true;
          offsets.set(path, tail.offset);
          for (const line of tail.lines.slice(-BACKLOG_LINES)) {
            let ts = 0;
            try {
              ts = (JSON.parse(line) as { tsUs?: number }).tsUs ?? 0;
            } catch {
              /* keep unparseable lines at the front */
            }
            backlog.push({ ts, line });
          }
        } else {
          offsets.set(path, 0);
        }
        remainders.set(path, "");
      }
      backlog.sort((a, b) => a.ts - b.ts);
      for (const { line } of backlog.slice(-BACKLOG_LINES)) send("activity", line);
      // Live only once the activity file exists; a machine the MCP never ran
      // on stays "waiting" until the file appears.
      send("channel", JSON.stringify({ channel: fileSeen ? "live" : "waiting" }));

      const poll = setInterval(async () => {
        for (const path of files) {
          const res = await readSince(path, offsets.get(path) ?? 0, remainders.get(path) ?? "");
          if (!res) continue;
          if (!fileSeen) {
            fileSeen = true;
            send("channel", JSON.stringify({ channel: "live" }));
          }
          offsets.set(path, res.offset);
          remainders.set(path, res.remainder);
          for (const line of res.lines) send("activity", line);
        }
      }, POLL_MS);

      const beat = setInterval(comment, HEARTBEAT_MS);

      const shutdown = () => {
        closed = true;
        clearInterval(poll);
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", shutdown);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
