import { BrowserWindow, app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

/** Where an operator goes when this build cannot update itself. */
export const RELEASES_URL =
  "https://github.com/altnautica/ADOSMissionControlGCS/releases";

/**
 * What this build can actually do about updates on the machine it is running
 * on, as opposed to what the updater library is willing to be told to do.
 *
 * `auto` means electron-updater can download a new version and install it.
 * `manual` means the check itself works and will report a newer version, but
 * this build cannot install one, so the operator has to fetch the release by
 * hand. `off` means there is no release channel to check against at all.
 */
export type UpdateCapability =
  | { mode: "auto" }
  | { mode: "manual"; reason: string }
  | { mode: "off"; reason: string };

export interface UpdateEnvironment {
  platform: NodeJS.Platform;
  /** `app.isPackaged` — false when running from a source tree. */
  isPackaged: boolean;
  /** `process.env.APPIMAGE` — set only when the app runs from an AppImage. */
  appImagePath?: string;
  /**
   * Whether this build carries a code signature the updater verifies before
   * installing. `electron-builder.yml` signs nothing today, so the shipped
   * value is false; self-install comes back on Windows and Linux only together
   * with real signing.
   */
  codeSigned?: boolean;
}

/**
 * Decide, from facts about the running process, whether self-update is real
 * here. This is deliberately a pure function so the platform split is stated
 * in one place and can be asserted directly instead of being inferred from
 * whatever the updater happens to do at runtime.
 */
export function resolveUpdateCapability(
  env: UpdateEnvironment,
): UpdateCapability {
  if (!env.isPackaged) {
    // electron-updater short-circuits an unpackaged check to a null result and
    // logs why. Skipping the call ourselves keeps that one line of dev-time
    // noise out of the log without having to blind the logger to do it.
    return {
      mode: "off",
      reason:
        "the app is running unpackaged, so there is no published release channel to check against",
    };
  }

  if (env.platform === "darwin") {
    // The macOS install path hands the downloaded build to Squirrel.Mac, which
    // validates its code signature against the running app's. Our macOS builds
    // are neither signed with a Developer ID nor notarized (see the mac block
    // in electron-builder.yml), so that hand-off cannot succeed. Checking is
    // still an ordinary metadata fetch and still tells the operator something
    // useful, so only the install half is off.
    return {
      mode: "manual",
      reason:
        "this macOS build is not code-signed or notarized, so it cannot install an update into itself",
    };
  }

  // `electron-builder.yml` carries no Windows signing block and no
  // `publisherName`, and the Linux AppImage is unsigned, so electron-updater
  // would verify nothing and the only integrity control is the SHA-512 in the
  // HTTPS-fetched metadata. Returning `auto` armed `autoInstallOnAppQuit`, i.e.
  // silently installed an unverified binary at quit. Restore `auto` together
  // with real code signing, not before.
  if ((env.platform === "win32" || env.platform === "linux") && !env.codeSigned) {
    const os = env.platform === "win32" ? "Windows" : "Linux";
    return {
      mode: "manual",
      reason: `this ${os} build is not code-signed, so an update cannot be verified before it installs itself`,
    };
  }

  if (env.platform === "linux" && !env.appImagePath) {
    // The Linux updater installs by replacing the running AppImage file, which
    // it locates through the APPIMAGE environment variable. Without it there is
    // no file to replace and the install throws rather than doing anything.
    return {
      mode: "manual",
      reason:
        "the Linux updater installs by replacing the running AppImage, and this process was not started from one",
    };
  }

  return { mode: "auto" };
}

function describe(capability: UpdateCapability): string {
  return capability.mode === "auto"
    ? "self-update is available"
    : `${capability.reason}; download updates from ${RELEASES_URL}`;
}

/** Which updater call was in flight when an `error` event arrived. */
export type UpdatePhase = "check" | "download" | "install";

/**
 * What the renderer is told about updates, pushed on `update:status` and
 * readable at any time through `update:status` (invoke), so a page that
 * mounts after the startup check still learns its result.
 */
export type UpdateStatus =
  | { state: "idle" }
  /** `installable` is false where only a manual download from `releasesUrl` works. */
  | { state: "available"; version: string; installable: boolean; releasesUrl: string }
  | { state: "downloading"; version: string }
  | { state: "downloaded"; version: string }
  /** The release channel could not be reached; normal for a GCS offline in the field. */
  | { state: "check-failed"; message: string }
  /** A download or install failed; a failed download can be retried. */
  | { state: "error"; phase: "download" | "install"; message: string };

/**
 * Wire up update checking. Returns the capability that was resolved so a
 * caller can report it too.
 *
 * The environment is injectable so the platform split can be exercised without
 * a packaged app on each OS.
 */
export function setupAutoUpdater(
  win: BrowserWindow,
  env: UpdateEnvironment = {
    platform: process.platform,
    isPackaged: app.isPackaged,
    appImagePath: process.env.APPIMAGE,
    codeSigned: false,
  },
): UpdateCapability {
  const capability = resolveUpdateCapability(env);

  // Never download behind the operator's back; a GCS mid-flight has no business
  // pulling a release down on its own.
  autoUpdater.autoDownload = false;

  // Only arm the quit-time install where an install can actually happen.
  // Leaving this on everywhere is what made the path look alive on macOS: the
  // app claimed it would update itself on quit and then never did.
  autoUpdater.autoInstallOnAppQuit = capability.mode === "auto";

  // The logger was previously nulled to hide the single info line an unpackaged
  // check emits. That also swallowed every download and install failure, which
  // is the difference between an update that did not happen and an update that
  // failed. The unpackaged case is handled by not checking, so the logger stays
  // wired to a real sink.
  autoUpdater.logger = console;

  let status: UpdateStatus = { state: "idle" };
  // The newest version the channel offered. Kept apart from `status` so a
  // failed download, which publishes `error`, can still be retried.
  let availableVersion: string | null = null;
  // Set before every updater call, so an `error` event (which carries no
  // context) is attributed to the call that raised it.
  let phase: UpdatePhase = "check";
  const publish = (next: UpdateStatus): void => {
    status = next;
    if (!win.isDestroyed()) win.webContents.send("update:status", next);
  };

  // Without a listener the library's own error dispatch hits Node's unhandled
  // 'error' behaviour and is then swallowed by the library's internal catch, so
  // this listener is what makes a failed download or install observable at all.
  // electron-updater also emits `error` when a CHECK fails, which on a field
  // GCS without internet is routine, so that case is reported as information,
  // not as a failed update.
  autoUpdater.on("error", (err: Error) => {
    const message = err?.message || String(err);
    if (phase === "check") {
      console.warn("[updater] update check failed:", err?.stack || message);
      publish({ state: "check-failed", message });
      return;
    }
    console.error(`[updater] update ${phase} failed:`, err?.stack || message);
    publish({ state: "error", phase, message });
  });

  autoUpdater.on("update-not-available", () => {
    if (status.state === "idle" || status.state === "check-failed" || status.state === "available") {
      publish({ state: "idle" });
    }
  });

  autoUpdater.on("update-available", (info) => {
    if (capability.mode === "auto") {
      console.info(`[updater] version ${info.version} is available`);
    } else {
      console.warn(
        `[updater] version ${info.version} is available but this build cannot install it: ${describe(capability)}`,
      );
    }
    availableVersion = info.version;
    publish({
      state: "available",
      version: info.version,
      installable: capability.mode === "auto",
      releasesUrl: RELEASES_URL,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.info(`[updater] version ${info.version} downloaded and ready`);
    publish({ state: "downloaded", version: info.version });
  });

  /** Only the main window's own frame may query or drive the updater. */
  const fromMainWindow = (event: { sender: Electron.WebContents }): boolean =>
    !win.isDestroyed() && event.sender === win.webContents;

  ipcMain.handle("update:status", (e): UpdateStatus => {
    if (!fromMainWindow(e)) throw new Error("update:status: unauthorized sender");
    return status;
  });

  // `autoDownload` is off, so this operator request is the only thing that
  // ever fetches a release. A build that cannot install refuses up front
  // rather than downloading something it can never apply.
  ipcMain.handle("update:download", async (e) => {
    if (!fromMainWindow(e)) throw new Error("update:download: unauthorized sender");
    if (capability.mode !== "auto") {
      const message = `Cannot download an update: ${describe(capability)}`;
      console.error(`[updater] ${message}`);
      throw new Error(message);
    }
    if (availableVersion === null) {
      throw new Error("Cannot download an update: no newer version has been found");
    }
    if (status.state === "downloading" || status.state === "downloaded") {
      throw new Error(`Cannot download an update: it is already ${status.state}`);
    }
    publish({ state: "downloading", version: availableVersion });
    phase = "download";
    // A failure is published by the `error` listener and rejects the invoke.
    await autoUpdater.downloadUpdate();
  });

  // Refuse loudly rather than calling into an install that cannot run. The
  // previous handler always called quitAndInstall(), which on a build with
  // nothing installable returns false internally and resolves the renderer's
  // promise as though the install had been accepted.
  ipcMain.handle("update:install", (e) => {
    if (!fromMainWindow(e)) throw new Error("update:install: unauthorized sender");
    if (capability.mode !== "auto") {
      const message = `Cannot install an update: ${describe(capability)}`;
      console.error(`[updater] ${message}`);
      throw new Error(message);
    }
    if (status.state !== "downloaded") {
      throw new Error("Cannot install an update: nothing has been downloaded");
    }
    phase = "install";
    autoUpdater.quitAndInstall();
  });

  const check = async (): Promise<void> => {
    phase = "check";
    try {
      const result = await autoUpdater.checkForUpdates();
      // A null result means the library declined the check; otherwise report
      // what the channel is actually offering, so "no update" and "never
      // asked" are distinguishable in the log.
      if (result == null) {
        console.warn("[updater] update check returned no result");
      } else {
        console.info(`[updater] latest published version is ${result.updateInfo.version}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[updater] update check failed:", err instanceof Error ? err.stack : message);
      publish({ state: "check-failed", message });
    }
  };

  // An operator-requested check, from the About section. Resolves with the
  // status the check left behind, so the caller can say "up to date".
  ipcMain.handle("update:check", async (e): Promise<UpdateStatus> => {
    if (!fromMainWindow(e)) throw new Error("update:check: unauthorized sender");
    if (capability.mode === "off") {
      throw new Error(`Cannot check for updates: ${describe(capability)}`);
    }
    // A download in progress or waiting to install is newer news than a check.
    if (status.state === "downloading" || status.state === "downloaded") return status;
    await check();
    return status;
  });

  if (capability.mode === "off") {
    console.info(`[updater] update check skipped: ${describe(capability)}`);
    return capability;
  }

  console.info(`[updater] checking for updates: ${describe(capability)}`);
  void check();

  return capability;
}
