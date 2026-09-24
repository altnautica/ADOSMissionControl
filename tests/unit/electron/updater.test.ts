/**
 * The desktop updater is only honest if it refuses to claim a capability it
 * does not have. These tests pin the platform split and the reporting: a build
 * that cannot install an update must not arm the quit-time install, must not
 * accept an install request, and must never swallow a failure — an operator
 * gets either a working update or a stated reason there is none.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted so the module factories below (which vitest lifts above the imports)
// can close over the same objects the assertions read.
const { ipcHandlers, autoUpdater } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: undefined as unknown,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    downloadUpdate: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: { isPackaged: true },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
  BrowserWindow: class {},
}));

vi.mock("electron-updater", () => ({ autoUpdater }));

import {
  resolveUpdateCapability,
  setupAutoUpdater,
  RELEASES_URL,
  type UpdateEnvironment,
} from "../../../electron/updater";

const PACKAGED_MAC: UpdateEnvironment = { platform: "darwin", isPackaged: true };
const PACKAGED_WIN: UpdateEnvironment = { platform: "win32", isPackaged: true };
const PACKAGED_APPIMAGE: UpdateEnvironment = {
  platform: "linux",
  isPackaged: true,
  appImagePath: "/tmp/AltnauticaCommand.AppImage",
};

/** A window stand-in; the updater only ever asks whether it can still be sent to. */
function fakeWindow() {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as unknown as Parameters<typeof setupAutoUpdater>[0];
}

/** Run the handler `setupAutoUpdater` registered for an emitted updater event. */
function emit(event: string, payload: unknown) {
  for (const [name, handler] of autoUpdater.on.mock.calls as [
    string,
    (arg: unknown) => void,
  ][]) {
    if (name === event) handler(payload);
  }
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ipcHandlers.clear();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = undefined;
  autoUpdater.on.mockReset();
  autoUpdater.quitAndInstall.mockReset();
  autoUpdater.downloadUpdate.mockReset();
  autoUpdater.downloadUpdate.mockResolvedValue([]);
  autoUpdater.checkForUpdates.mockReset();
  autoUpdater.checkForUpdates.mockResolvedValue({
    updateInfo: { version: "9.9.9" },
  });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveUpdateCapability", () => {
  it("reports macOS as manual because the build is unsigned", () => {
    const capability = resolveUpdateCapability(PACKAGED_MAC);
    expect(capability.mode).toBe("manual");
    expect(capability.mode === "manual" && capability.reason).toMatch(
      /not code-signed or notarized/,
    );
  });

  it("refuses to self-install on Windows while the build is unsigned", () => {
    // `electron-builder.yml` carries no Windows signing block and no
    // `publisherName`, so electron-updater skips signature verification
    // entirely. Returning `auto` here armed `autoInstallOnAppQuit` and
    // silently installed an unverified binary at quit.
    const cap = resolveUpdateCapability(PACKAGED_WIN);
    expect(cap.mode).toBe("manual");
    expect(cap.mode === "manual" && cap.reason).toMatch(/code-signed/);
  });

  it("reports Linux as self-updating only when running from an AppImage", () => {
    expect(resolveUpdateCapability(PACKAGED_APPIMAGE)).toEqual({ mode: "auto" });

    const outsideAppImage = resolveUpdateCapability({
      platform: "linux",
      isPackaged: true,
    });
    expect(outsideAppImage.mode).toBe("manual");
    expect(outsideAppImage.mode === "manual" && outsideAppImage.reason).toMatch(
      /AppImage/,
    );
  });

  it("reports an unpackaged app as having nothing to check", () => {
    expect(
      resolveUpdateCapability({ platform: "win32", isPackaged: false }).mode,
    ).toBe("off");
    // Being unpackaged wins over the platform split; the reason must say so
    // rather than blaming code signing.
    const macDev = resolveUpdateCapability({
      platform: "darwin",
      isPackaged: false,
    });
    expect(macDev.mode).toBe("off");
    expect(macDev.mode === "off" && macDev.reason).toMatch(/unpackaged/);
  });
});

describe("setupAutoUpdater", () => {
  it("does not arm the quit-time install where an install cannot run", () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_MAC);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("keeps the quit-time install armed where it works", () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_APPIMAGE);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(autoUpdater.autoDownload).toBe(false);
  });

  it("does NOT arm the quit-time install on an unsigned Windows build", () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_WIN);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("leaves the updater logger wired to a real sink", () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_WIN);
    expect(autoUpdater.logger).not.toBeNull();
  });

  it("listens for updater errors and reports them", () => {
    const win = fakeWindow();
    setupAutoUpdater(win, PACKAGED_WIN);

    const registered = (autoUpdater.on.mock.calls as [string, unknown][]).map(
      ([name]) => name,
    );
    expect(registered).toContain("error");

    emit("error", new Error("install exploded"));
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/install exploded/);
  });

  it("refuses an install request instead of pretending it was accepted", async () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_MAC);
    const install = ipcHandlers.get("update:install");
    expect(install).toBeDefined();

    expect(() => install!()).toThrow(/not code-signed or notarized/);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("still installs where an install works, once a version is downloaded", () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_APPIMAGE);
    emit("update-downloaded", { version: "1.2.3" });
    ipcHandlers.get("update:install")!();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("refuses an install before anything was downloaded", () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_APPIMAGE);
    expect(() => ipcHandlers.get("update:install")!()).toThrow(/nothing has been downloaded/);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("downloads an available version only when the operator asks", async () => {
    const win = fakeWindow();
    setupAutoUpdater(win, PACKAGED_APPIMAGE);
    emit("update-available", { version: "1.2.3" });
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();

    await ipcHandlers.get("update:download")!();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(ipcHandlers.get("update:status")!()).toEqual({
      state: "downloading",
      version: "1.2.3",
    });
  });

  it("lets the operator retry a download that failed", async () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_APPIMAGE);
    emit("update-available", { version: "1.2.3" });
    await ipcHandlers.get("update:download")!();
    emit("error", new Error("connection reset"));

    await ipcHandlers.get("update:download")!();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(ipcHandlers.get("update:status")!()).toEqual({
      state: "downloading",
      version: "1.2.3",
    });
  });

  it("refuses a download on a build that cannot install", async () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_MAC);
    emit("update-available", { version: "1.2.3" });
    await expect(
      Promise.resolve().then(() => ipcHandlers.get("update:download")!()),
    ).rejects.toThrow(/not code-signed or notarized/);
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("pushes every status change to the window and keeps the latest for late readers", () => {
    const win = fakeWindow();
    setupAutoUpdater(win, PACKAGED_MAC);
    expect(ipcHandlers.get("update:status")!()).toEqual({ state: "idle" });

    emit("update-available", { version: "1.2.3" });
    const available = {
      state: "available",
      version: "1.2.3",
      installable: false,
      releasesUrl: RELEASES_URL,
    };
    expect(win.webContents.send).toHaveBeenLastCalledWith("update:status", available);
    expect(ipcHandlers.get("update:status")!()).toEqual(available);

    emit("error", new Error("feed unreachable"));
    expect(ipcHandlers.get("update:status")!()).toEqual({
      state: "error",
      message: "feed unreachable",
    });
  });

  it("names the manual download route when a version it cannot install appears", () => {
    const win = fakeWindow();
    setupAutoUpdater(win, PACKAGED_MAC);

    emit("update-available", { version: "1.2.3" });
    const warned = warnSpy.mock.calls.flat().join(" ");
    expect(warned).toMatch(/1\.2\.3/);
    expect(warned).toContain(RELEASES_URL);
  });

  it("reports a failed update check instead of swallowing it", async () => {
    autoUpdater.checkForUpdates.mockRejectedValue(new Error("feed unreachable"));
    setupAutoUpdater(fakeWindow(), PACKAGED_WIN);

    await vi.waitFor(() => {
      expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/feed unreachable/);
    });
  });

  it("checks on macOS even though it cannot install", async () => {
    setupAutoUpdater(fakeWindow(), PACKAGED_MAC);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("does not check when there is no release channel to check against", () => {
    setupAutoUpdater(fakeWindow(), { platform: "win32", isPackaged: false });
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });
});
