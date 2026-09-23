import { app, BrowserWindow, shell } from "electron";
import path from "path";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function isLocalAppUrl(url: string, port: number): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === String(port)
    );
  } catch {
    return false;
  }
}

function openExternalUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return;
    void shell.openExternal(parsed.toString());
  } catch {
    // Ignore malformed navigation targets.
  }
}

/** Create and configure the main application window. */
export function createMainWindow(port: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0A0A0F",
    show: false,
    // macOS and Linux use the native title bar so the OS window controls sit in
    // their own bar and never overlap app content. Windows keeps a hidden title
    // bar paired with a custom overlay (set below).
    titleBarStyle: process.platform === "win32" ? "hidden" : "default",
    ...(process.platform === "win32" ? {
      titleBarOverlay: {
        color: "#0A0A0F",
        symbolColor: "#fafafa",
        height: 48,
      },
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Required for WebSerial and WebUSB
      webSecurity: true,
    },
  });

  // Safety timeout: if ready-to-show never fires, force-show the window.
  const showTimeout = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      console.error("[window] ready-to-show timeout — forcing show");
      win.show();
      if (!app.isPackaged) {
        win.webContents.openDevTools({ mode: "detach" });
      }
    }
  }, 10000);

  win.once("ready-to-show", () => {
    clearTimeout(showTimeout);
    win.show();
  });

  // Log page load events for diagnostics. Force-show the window on either
  // outcome so a renderer that loaded but never emitted ready-to-show, or a
  // page that failed to load, never leaves the user staring at a dock icon
  // with no window.
  win.webContents.on("did-finish-load", () => {
    console.log("[window] did-finish-load");
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[window] did-fail-load: ${code} ${desc} ${url}`);
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
      if (!app.isPackaged) {
        win.webContents.openDevTools({ mode: "detach" });
      }
    }
  });

  // Load the Next.js app
  win.loadURL(`http://127.0.0.1:${port}`);

  // Navigation policy, applied to EVERY WebContents this app creates.
  //
  // It used to be registered on `win.webContents` only, and an allowed
  // same-origin popup inherits `webPreferences` — including the preload, and
  // therefore `electronAPI.net`. With no guard of its own, that popup could
  // then be navigated (or REDIRECTED — `will-redirect` had no handler at all)
  // to a remote origin, yielding a remote page holding a raw-socket bridge.
  applyNavigationPolicy(win.webContents, port);

  return win;
}

/**
 * Deny every navigation and popup that leaves the local app origin, on one
 * WebContents. Registered for the main window and, via
 * `app.on("web-contents-created")`, for every child it opens.
 */
export function applyNavigationPolicy(
  contents: Electron.WebContents,
  port: number,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    // `window.open("", name)` (the detached HUD and telemetry deck) opens an
    // about:blank popup that the opener renders into through a portal. It
    // loads nothing remote, gets this same policy through
    // `web-contents-created`, and the socket IPC answers only the main
    // window's own frame, so it gains no privilege by being allowed.
    if (url === "about:blank" || isLocalAppUrl(url, port)) {
      return { action: "allow" };
    }
    openExternalUrl(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (!isLocalAppUrl(url, port)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });

  // A server-side redirect is a navigation the `will-navigate` handler never
  // sees: it fires once for the initial URL and not for the hop.
  contents.on("will-redirect", (event, url) => {
    if (!isLocalAppUrl(url, port)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });

  // No renderer in this app embeds a webview, and one would inherit the
  // preload; refuse the attach outright rather than rely on the default.
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}
