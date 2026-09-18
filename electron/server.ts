import { ChildProcess, fork } from "child_process";
import { createServer as createTcpServer } from "net";
import path from "path";
import fs from "fs";
import http from "http";
import { app } from "electron";

let serverProcess: ChildProcess | null = null;
let serverPort: number = 4000;

/** Find a free port, starting with the preferred one. */
async function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createTcpServer();
    srv.listen(preferred, "127.0.0.1", () => {
      srv.close(() => resolve(preferred));
    });
    srv.on("error", () => {
      // Preferred port taken — let OS assign one
      const srv2 = createTcpServer();
      srv2.listen(0, "127.0.0.1", () => {
        const addr = srv2.address();
        if (addr && typeof addr === "object") {
          srv2.close(() => resolve(addr.port));
        } else {
          reject(new Error("Could not find free port"));
        }
      });
      srv2.on("error", reject);
    });
  });
}

/**
 * Find server.js under a standalone root. Handles both the normal layout
 * (standalone/server.js) and the nested layout Next can emit when the project
 * path includes extra segments (standalone/<...>/server.js). The build's
 * postbuild step should flatten this; this walk is a defensive fallback.
 */
function findStandaloneServerJs(standaloneRoot: string): string | null {
  const direct = path.join(standaloneRoot, "server.js");
  if (fs.existsSync(direct)) return direct;

  function walk(dir: string, depth: number): string | null {
    if (depth > 6) return null;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return null;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".next" || name === "public")
        continue;
      const child = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(child);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const candidate = path.join(child, "server.js");
      if (fs.existsSync(candidate)) return candidate;
      const nested = walk(child, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  return walk(standaloneRoot, 0);
}

/** Resolve path to the standalone server.js (nested-layout aware). */
function getServerPath(): string {
  const standaloneRoot = app.isPackaged
    ? path.join(process.resourcesPath, "standalone")
    : path.join(__dirname, "..", ".next", "standalone");

  const found = findStandaloneServerJs(standaloneRoot);
  if (found) return found;

  // Default expected path (best error message if missing entirely).
  return path.join(standaloneRoot, "server.js");
}

/** Get the static files directory (for diagnostic logging only). */
function getStaticDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "standalone", ".next", "static");
  }
  return path.join(__dirname, "..", ".next", "static");
}

/** Repo root in dev (one level up from the compiled dist-electron/). */
function getRepoRoot(): string {
  return path.join(__dirname, "..");
}

/**
 * Ensure Cesium runtime assets exist under public/cesium for the dev server.
 *
 * `npm run dev` does this via its `predev` copy step, but the dev flow forks
 * the Next CLI directly, so replicate the copy here. No-op if already present.
 */
function ensureCesiumAssets(repoRoot: string): void {
  const dst = path.join(repoRoot, "public", "cesium");
  if (fs.existsSync(dst)) return;
  const src = path.join(repoRoot, "node_modules", "cesium", "Build", "Cesium");
  if (!fs.existsSync(src)) {
    console.warn(`[server] cesium source missing at ${src}; skipping copy`);
    return;
  }
  fs.cpSync(src, dst, { recursive: true });
  console.log(`[server] copied cesium assets -> ${dst}`);
}

/** Forward a child server's stdout/stderr and clear the handle on exit. */
function wireChildLogging(child: ChildProcess): void {
  child.stdout?.on("data", (data: Buffer) => {
    console.log(`[server] ${data.toString().trim()}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    console.error(`[server] ${data.toString().trim()}`);
  });

  child.on("exit", (code) => {
    console.log(`[server] exited with code ${code}`);
    serverProcess = null;
  });
}

/**
 * Wait for the server to respond to HTTP requests. Rejects early if the child
 * process exits before becoming ready (surfacing its crash instead of waiting
 * out the full timeout).
 */
async function waitForReady(
  port: number,
  child: ChildProcess,
  timeoutMs: number = 15000
): Promise<void> {
  const start = Date.now();
  const interval = 200;

  return new Promise((resolve, reject) => {
    let settled = false;

    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Server exited with code ${code} before it was ready`));
    };
    child.once("exit", onExit);

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", onExit);
      action();
    };

    const check = () => {
      if (settled) return;

      if (Date.now() - start > timeoutMs) {
        settle(() => reject(new Error(`Server did not start within ${timeoutMs}ms`)));
        return;
      }

      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        if (res.statusCode && res.statusCode < 500) {
          settle(() => resolve());
        } else {
          setTimeout(check, interval);
        }
        res.resume();
      });

      req.on("error", () => {
        setTimeout(check, interval);
      });

      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(check, interval);
      });
    };

    check();
  });
}

interface StartOptions {
  demo?: boolean;
  dev?: boolean;
}

/** Fork a live `next dev` server (HMR) for the desktop dev flow. */
function spawnDevChild(port: number, options: StartOptions): ChildProcess {
  const repoRoot = getRepoRoot();
  ensureCesiumAssets(repoRoot);

  const env: Record<string, string> = {
    ...((process.env as Record<string, string>) || {}),
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    // Silence the first-run telemetry notice in the dev child.
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (options.demo) {
    env.NEXT_PUBLIC_DEMO_MODE = "true";
  }

  // Fork the Next CLI directly (not `npm run dev`) so the child is a single
  // killable node process that stopServer's SIGTERM tears down cleanly.
  const nextBin = require.resolve("next/dist/bin/next");
  console.log(`[server] starting next dev on port ${port}`);
  // `--hostname` is passed EXPLICITLY. The installed Next dev CLI takes the
  // host only from the flag and ignores `HOSTNAME` entirely, so setting the
  // env var above bound `next dev` to 0.0.0.0 — every interface — and
  // `npm run desktop:dev` published the operator's dev GCS to the LAN.
  return fork(nextBin, ["dev", "--turbo", "--hostname", "127.0.0.1", "--port", String(port)], {
    env,
    stdio: "pipe",
    cwd: repoRoot,
  });
}

/** Fork the production standalone bundle (packaged builds / preview). */
function spawnStandaloneChild(port: number, options: StartOptions): ChildProcess {
  const serverPath = getServerPath();

  // Fail fast with an actionable message instead of forking a missing path
  // and waiting out the readiness timeout.
  if (!fs.existsSync(serverPath)) {
    throw new Error(
      `Standalone build not found at ${serverPath}. Run \`npm run build\` first ` +
        `(or use \`npm run desktop:dev\` for the live dev server).`,
    );
  }

  const env: Record<string, string> = {
    ...((process.env as Record<string, string>) || {}),
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
  };
  if (options.demo) {
    env.NEXT_PUBLIC_DEMO_MODE = "true";
  }

  // Diagnostic: verify static directory exists in packaged builds
  if (app.isPackaged) {
    const staticDir = getStaticDir();
    try {
      const entries = fs.readdirSync(staticDir);
      console.log(`[electron] Static dir OK: ${entries.join(", ")}`);
    } catch (err: any) {
      console.error(`[electron] Static dir MISSING: ${staticDir}`, err.message);
    }
  }

  return fork(serverPath, [], {
    env,
    stdio: "pipe",
    // Cwd is the directory containing server.js (and its node_modules), not the
    // monorepo root — important when the standalone output is still nested.
    cwd: path.dirname(serverPath),
  });
}

/**
 * Start the embedded server. Returns the port.
 *
 * In dev (`options.dev` and unpackaged) this forks a live `next dev` server
 * with HMR. Otherwise it forks the production standalone bundle, which serves
 * static files natively when `.next/static/` is present alongside it.
 */
export async function startServer(options: StartOptions = {}): Promise<number> {
  const isDev = !app.isPackaged && !!options.dev;
  const port = await findFreePort(4000);

  serverProcess = isDev
    ? spawnDevChild(port, options)
    : spawnStandaloneChild(port, options);

  wireChildLogging(serverProcess);

  // A cold first Turbopack compile of this app can exceed the standalone
  // server's near-instant boot, so allow much longer in dev.
  await waitForReady(port, serverProcess, isDev ? 120000 : 15000);

  serverPort = port;
  console.log(`[server] ready on port ${serverPort}`);
  return serverPort;
}

/** Gracefully stop the server. */
export async function stopServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");

    // Wait up to 5 seconds for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (serverProcess) {
          serverProcess.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      serverProcess!.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    serverProcess = null;
  }
}
