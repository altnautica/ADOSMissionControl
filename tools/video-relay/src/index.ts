import { createServer, type IncomingMessage } from "node:http";
import { type ChildProcess, spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3001", 10);
const RTSP_URL_PATTERN =
  process.env.RTSP_URL_PATTERN || "rtsp://localhost:8554/{deviceId}";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamSession {
  ffmpeg: ChildProcess;
  clients: Set<WebSocket>;
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
  const match = url.match(/^\/ws\/stream\/([a-zA-Z0-9_-]+)$/);
  return match ? match[1] : null;
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

  const session: StreamSession = { ffmpeg, clients: new Set() };

  ffmpeg.stdout!.on("data", (chunk: Buffer) => {
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
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
  // Health check endpoint
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    activeSessions: sessions.size,
    sessions: Object.fromEntries(
      [...sessions.entries()].map(([id, s]) => [id, s.clients.size])
    ),
  }));
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const deviceId = parseDeviceId(req.url);

  if (!deviceId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
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

server.listen(PORT, () => {
  log(`Video relay listening on port ${PORT}`);
  log(`RTSP pattern: ${RTSP_URL_PATTERN}`);
  log(`WebSocket endpoint: ws://localhost:${PORT}/ws/stream/{deviceId}`);
});
