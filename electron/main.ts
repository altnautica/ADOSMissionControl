import { app, dialog, Menu, session } from "electron";
import fs from "fs";
import path from "path";
import { startupFailureBox } from "./desktop-dialogs";
import { buildAppMenuTemplate } from "./app-menu";
import { setupPermissions } from "./permissions";
import { startServer, stopServer } from "./server";
import { applyNavigationPolicy, createMainWindow } from "./window";
import { setupAutoUpdater } from "./updater";
import { setupNetSockets, closeAllSockets } from "./net-sockets";
import { setupLocalNodeKeys } from "./local-node-keys";

// Enable Chromium features required by Command GCS
app.commandLine.appendSwitch("enable-features", "WebSerial,WebUSB");

// Parse CLI flags
const isDemoMode = process.argv.includes("--demo");
const isDevMode = process.argv.includes("--dev");

// In dev, silence Electron's CSP / insecure-content advisory warnings in the
// renderer console. Our CSP intentionally allows 'unsafe-eval' for some libs,
// so the warnings are dev-only noise. Must be set before the window loads.
// Packaged builds suppress these warnings already.
if (isDevMode) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

// Windows installer events: exit early on Squirrel install/update/uninstall so
// the installer's silent process never lingers as a windowless background app.
if (process.platform === "win32") {
  const squirrelEvent = process.argv.find((a) =>
    ["--squirrel-install", "--squirrel-updated", "--squirrel-uninstall", "--squirrel-obsolete"].includes(a),
  );
  if (squirrelEvent) {
    app.quit();
    process.exit(0);
  }
}

// Prevent multiple instances. The second-instance handler below focuses the
// existing window when the user re-launches.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(buildAppMenuTemplate(app.isPackaged, process.platform)),
    );

    // Start the embedded server. In dev (--dev, unpackaged) this is a live
    // `next dev` server with HMR; otherwise it's the production standalone bundle.
    const port = await startServer({ demo: isDemoMode, dev: isDevMode });

    // Device permissions (WebSerial, WebUSB) are granted only to the app's
    // own origin, which is known once the server has its port.
    setupPermissions(port);

    // Request diagnostics for /_next/* are opt-in: logging every request for
    // the life of a long session buries the errors that matter.
    if (app.isPackaged && process.env.ADOS_DEBUG_REQUESTS === "1") {
      const filter = { urls: [`http://127.0.0.1:${port}/_next/*`] };
      session.defaultSession.webRequest.onCompleted(filter, (details) => {
        console.log(`[req] ${details.statusCode} ${details.url.substring(0, 120)}`);
      });
      session.defaultSession.webRequest.onErrorOccurred(filter, (details) => {
        console.error(`[req] ERR ${details.error} ${details.url.substring(0, 120)}`);
      });
    }

    // Every WebContents the app creates gets the navigation policy, not just
    // the main window: a same-origin popup inherits the preload (and so
    // `electronAPI.net`) but inherited none of the guards.
    app.on("web-contents-created", (_event, contents) => {
      applyNavigationPolicy(contents, port);
    });

    // Create the main browser window
    const win = createMainWindow(port);

    // Native UDP/TCP MAVLink sockets (the browser can't open raw sockets).
    setupNetSockets(win);

    // Paired-node API keys sealed with the OS key store.
    setupLocalNodeKeys(win);

    // Setup auto-updater (silent check on startup)
    setupAutoUpdater(win);

    // macOS: re-create window when dock icon clicked
    app.on("activate", () => {
      if (!win.isDestroyed()) {
        win.show();
      }
    });
  } catch (err: any) {
    // Without this, a failed startup leaves a hidden process with no window —
    // the user sees a dock icon / Task Manager entry but nothing to interact
    // with. Surface the failure and exit cleanly instead.
    console.error("[main] startup failed:", err);
    // The forked Next child survives this path otherwise: no window ever
    // existed, so `window-all-closed` never fires and every FAILED launch
    // leaked another server holding the port.
    await stopServer().catch(() => undefined);
    const details = err?.stack || err?.message || String(err);
    // The stack goes to a file the operator can attach, not into the box.
    let logFile: string | null = null;
    try {
      const dir = app.getPath("logs");
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, "startup-error.log");
      fs.writeFileSync(logFile, `${new Date().toISOString()}\n${details}\n`);
    } catch {
      logFile = null;
    }
    try {
      const box = startupFailureBox(err?.message || String(err), logFile);
      dialog.showErrorBox(box.title, box.content);
    } catch {
      // dialog may be unavailable in some environments; fall through to quit
    }
    app.quit();
  }
}).catch((err) => {
  console.error("[main] whenReady handler failed:", err);
  app.quit();
});

app.on("second-instance", () => {
  // Focus existing window if user tries to open another instance
  const wins = require("electron").BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    if (wins[0].isMinimized()) wins[0].restore();
    wins[0].focus();
  }
});

/**
 * Single teardown path.
 *
 * `window-all-closed` is the ONE quit path Cmd+Q and `app.quit()` skip, and
 * it used to be the sole caller of `closeAllSockets()` / `stopServer()` — so
 * the forked Next child survived every macOS Quit and every
 * `quitAndInstall()`, holding port 4000 and keeping the GCS reachable after
 * the operator closed it. `will-quit` fires for every path.
 */
let teardownDone = false;
app.on("will-quit", (event) => {
  if (teardownDone) return;
  event.preventDefault();
  teardownDone = true;
  closeAllSockets("app quitting");
  void stopServer()
    .catch((err) => console.error("[main] stopServer failed:", err))
    .finally(() => app.exit(0));
});

app.on("window-all-closed", () => {
  app.quit();
});
