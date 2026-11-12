import { app, BrowserWindow, dialog, shell } from "electron";
import path from "path";
import {
  createBluetoothChooser,
  loadFailureDialog,
  shouldReportLoadFailure,
} from "./desktop-dialogs";

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

/** A URL handed to the OS browser within this window is not handed over again. */
const EXTERNAL_DEDUPE_MS = 1000;
let lastExternal: { url: string; at: number } | null = null;

function openExternalUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return;
    const target = parsed.toString();
    // A same-window link fires `will-navigate` and then `will-redirect` for
    // the same target; without this the OS browser opened it twice.
    const now = Date.now();
    if (lastExternal && lastExternal.url === target && now - lastExternal.at < EXTERNAL_DEDUPE_MS) {
      return;
    }
    lastExternal = { url: target, at: now };
    void shell.openExternal(target);
  } catch {
    // Ignore malformed navigation targets.
  }
}

/** Options for the native prompt shown when a page asks to block unload. */
export const UNLOAD_PROMPT: Electron.MessageBoxSyncOptions = {
  type: "question",
  title: "Leave this page?",
  message: "You have unsaved changes. Leave and discard them?",
  buttons: ["Leave", "Stay"],
  defaultId: 1,
  cancelId: 1,
  noLink: true,
};

/** Create and configure the main application window. */
export function createMainWindow(port: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#000000",
    show: false,
    // macOS and Linux use the native title bar so the OS window controls sit in
    // their own bar and never overlap app content. Windows keeps a hidden title
    // bar paired with a custom overlay (set below).
    titleBarStyle: process.platform === "win32" ? "hidden" : "default",
    ...(process.platform === "win32" ? {
      titleBarOverlay: {
        color: "#000000",
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
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    console.error(`[window] did-fail-load: ${code} ${desc} ${url}`);
    if (win.isDestroyed()) return;
    if (!win.isVisible()) {
      win.show();
      if (!app.isPackaged) {
        win.webContents.openDevTools({ mode: "detach" });
      }
    }
    if (!shouldReportLoadFailure(code, isMainFrame)) return;
    // An empty window gives the operator nothing to act on: offer Retry and Quit.
    void dialog.showMessageBox(win, loadFailureDialog(desc)).then(({ response }) => {
      if (win.isDestroyed()) return;
      if (response === 0) {
        void win.loadURL(`http://127.0.0.1:${port}`);
      } else {
        app.quit();
      }
    });
  });

  // Without a handler Electron connects to the first Bluetooth device that
  // answers the scan; ask the operator instead, as serial and USB do.
  const chooseBluetooth = createBluetoothChooser((labels) =>
    win.isDestroyed()
      ? -1
      : dialog.showMessageBoxSync(win, {
          type: "question",
          title: "Select Bluetooth device",
          message: "Choose the Bluetooth device Mission Control should use.",
          buttons: [...labels, "Cancel"],
          cancelId: labels.length,
          defaultId: labels.length,
          noLink: true,
        }),
  );
  win.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    chooseBluetooth(devices, callback);
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

  // Electron never shows the browser's "Leave site?" prompt: a page that calls
  // `preventDefault()` in `beforeunload` (unsaved plan, parameter edits, a
  // flash in progress) silently blocked closing or reloading the window.
  // Ask natively; Leave lets the unload proceed.
  contents.on("will-prevent-unload", (event) => {
    const owner = BrowserWindow.fromWebContents(contents);
    const choice = owner
      ? dialog.showMessageBoxSync(owner, UNLOAD_PROMPT)
      : dialog.showMessageBoxSync(UNLOAD_PROMPT);
    if (choice === 0) event.preventDefault();
  });
}
