import { createServer, type IncomingMessage } from "node:http";
import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3001", 10);
const RTSP_URL_PATTERN =
  process.env.RTSP_URL_PATTERN || "rtsp://localhost:8554/{deviceId}";

/**
 * Shared secret every viewer token is derived from.
 *
 * REQUIRED. The relay accepted ANY WebSocket — no token, no key, no origin
 * check — and then attached the client to (or spawned) an ffmpeg session for
 * whatever deviceId was in the path, while `GET /` answered every request
 * with the live device list. The default relay is a public hostname, so an
 * unauthenticated internet client could read the device list off `GET /` and
 * then watch that aircraft's camera. Refusing to start without a secret is
 * the only safe default: a relay that silently runs open is the bug.
 */
const AUTH_SECRET = process.env.VIDEO_RELAY_SECRET ?? "";

/** Max bytes buffered for one slow viewer before it is dropped. */
const MAX_VIEWER_BACKLOG_BYTES = parseInt(
  process.env.VIDEO_RELAY_MAX_BACKLOG || String(4 * 1024 * 1024),
  10,
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamSession {
  ffmpeg: ChildProcess;
  clients: Set<WebSocket>;
  /**
   * The fMP4 initialisation segment (ftyp + moov), captured from the first
   * chunk ffmpeg emits.
   *
   * A second viewer joining an existing session used to receive only the
   * media fragments already in flight, with no init segment, so its
   * `SourceBuffer` could never be configured and it failed permanently with
   * `codec-unknown`. Replaying the cached init makes a late join work.
   */
  initSegment: Buffer | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sessions = new Map<string, StreamSession>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rtspUrl(deviceId: string): string {
  return RTSP_URL_PATTERN.replace("{deviceId}", deviceId);
}

function parseDeviceId(url: string | undefined): string | null {
  if (!url) return null;
  const path = url.split("?")[0] ?? "";
  const match = path.match(/^\/ws\/stream\/([a-zA-Z0-9_-]+)$/);
  return match ? match[1] : null;
}

/** The token that authorises viewing exactly one device. */
export function viewerToken(deviceId: string, secret: string): string {
  return createHmac("sha256", secret).update(deviceId).digest("hex");
}

/**
 * Whether the request carries a token scoped to THIS device.
 *
 * Scoped, not a blanket bearer: a token for drone A must not open drone B's
 * camera. Accepts `Authorization: Bearer <token>` or `?token=<token>`, since
 * a browser `WebSocket` cannot set headers.
 */
function isAuthorized(req: IncomingMessage, deviceId: string): boolean {
  if (!AUTH_SECRET) return false;
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = new URL(req.url ?? "/", "http://relay.invalid").searchParams;
  const presented = bearer || query.get("token") || "";
  if (!presented) return false;
  const expected = viewerToken(deviceId, AUTH_SECRET);
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

// ---------------------------------------------------------------------------
// ffmpeg session lifecycle
// ---------------------------------------------------------------------------

function startSession(deviceId: string): StreamSession {
  const url = rtspUrl(deviceId);
  log(`Starting ffmpeg for device "${deviceId}" -> ${url}`);

  const ffmpeg = spawn("ffmpeg", [
    "-rtsp_transport", "tcp",
    "-i", url,
    "-c:v", "copy",
    "-an",
    "-f", "mp4",
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "pipe:1",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const session: StreamSession = { ffmpeg, clients: new Set(), initSegment: null };

  ffmpeg.stdout!.on("data", (chunk: Buffer) => {
    // First chunk carries ftyp+moov: the init segment a late joiner needs.
    if (session.initSegment === null) session.initSegment = chunk;
    for (const ws of session.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // Backpressure. `ws.send` queues without bound, so one slow viewer grew
      // the relay process until it was killed — taking every other viewer of
      // every other device with it. A viewer that cannot keep up is dropped;
      // it reconnects and resyncs.
      if (ws.bufferedAmount > MAX_VIEWER_BACKLOG_BYTES) {
        log(`Dropping slow viewer on "${deviceId}" (${ws.bufferedAmount} bytes queued)`);
        ws.close(1013, "Viewer too slow");
        continue;
      }
      ws.send(chunk);
    }
  });

  ffmpeg.stderr!.on("data", (data: Buffer) => {
    // ffmpeg writes progress and errors to stderr. Log sparingly.
    const line = data.toString().trim();
    if (line.length > 0) {
      log(`[ffmpeg:${deviceId}] ${line}`);
    }
  });

  ffmpeg.on("error", (err) => {
    log(`ffmpeg error for "${deviceId}": ${err.message}`);
    teardownSession(deviceId);
  });

  ffmpeg.on("exit", (code, signal) => {
    log(`ffmpeg exited for "${deviceId}" (code=${code}, signal=${signal})`);
    teardownSession(deviceId);
  });

  sessions.set(deviceId, session);
  return session;
}

function teardownSession(deviceId: string): void {
  const session = sessions.get(deviceId);
  if (!session) return;

  sessions.delete(deviceId);

  // Close all remaining clients
  for (const ws of session.clients) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1001, "Stream ended");
    }
  }
  session.clients.clear();

  // Kill ffmpeg if still running
  if (!session.ffmpeg.killed) {
    session.ffmpeg.kill("SIGTERM");
  }
}

function removeViewer(deviceId: string, ws: WebSocket): void {
  const session = sessions.get(deviceId);
  if (!session) return;

  session.clients.delete(ws);
  log(`Viewer disconnected from "${deviceId}" (${session.clients.size} remaining)`);

  if (session.clients.size === 0) {
    log(`No viewers left for "${deviceId}", stopping ffmpeg`);
    teardownSession(deviceId);
  }
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = createServer((_req, res) => {
  // Liveness probe ONLY. This used to answer EVERY path with the live device
  // list and per-device viewer counts, so an unauthenticated caller could
  // enumerate the fleet off a public hostname and then open the matching
  // stream. A probe reports that the relay is up, and nothing else.
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const deviceId = parseDeviceId(req.url);

  if (!deviceId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  // Authorise BEFORE handleUpgrade. Doing it after would already have
  // attached the client to — or spawned — an ffmpeg session for the device.
  if (!isAuthorized(req, deviceId)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, deviceId);
  });
});

wss.on("connection", (ws: WebSocket, _req: IncomingMessage, deviceId: string) => {
  log(`Viewer connected to "${deviceId}"`);

  // Get or create the ffmpeg session for this device
  let session = sessions.get(deviceId);
  if (!session) {
    session = startSession(deviceId);
  } else if (session.initSegment) {
    // Late joiner: replay the init segment so its SourceBuffer can be
    // configured. Without it the viewer received only media fragments and
    // failed permanently with `codec-unknown`.
    ws.send(session.initSegment);
  }
  session.clients.add(ws);

  log(`"${deviceId}" now has ${session.clients.size} viewer(s)`);

  ws.on("close", () => removeViewer(deviceId, ws));
  ws.on("error", (err) => {
    log(`WebSocket error for viewer on "${deviceId}": ${err.message}`);
    removeViewer(deviceId, ws);
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(): void {
  log("Shutting down...");
  for (const [deviceId] of sessions) {
    teardownSession(deviceId);
  }
  server.close(() => {
    log("Server closed");
    process.exit(0);
  });
  // Force exit after 5 seconds if graceful close hangs
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (!AUTH_SECRET) {
  // Fail closed. A relay that runs with no secret is an open camera feed for
  // every paired aircraft, reachable from anywhere the hostname resolves.
  console.error(
    "[video-relay] VIDEO_RELAY_SECRET is not set. Refusing to start: without it " +
      "every WebSocket would be accepted and any caller could watch any device.",
  );
  process.exit(1);
}

server.listen(PORT, () => {
  log(`Video relay listening on port ${PORT}`);
  log(`RTSP pattern: ${RTSP_URL_PATTERN}`);
  log(`WebSocket endpoint: ws://localhost:${PORT}/ws/stream/{deviceId}?token=...`);
});
