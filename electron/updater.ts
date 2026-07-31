import { BrowserWindow, app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

/** Where an operator goes when this build cannot update itself. */
export const RELEASES_URL =
  "https://github.com/altnautica/ADOSMissionControl/releases";

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

  // Without a listener the library's own error dispatch hits Node's unhandled
  // 'error' behaviour and is then swallowed by the library's internal catch, so
  // this listener is what makes a failed download or install observable at all.
  autoUpdater.on("error", (err: Error) => {
    console.error("[updater] update failed:", err?.stack || err?.message || err);
    if (!win.isDestroyed()) {
      win.webContents.send("update-error", {
        message: err?.message || String(err),
      });
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
    if (!win.isDestroyed()) {
      win.webContents.send("update-available", { version: info.version });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.info(`[updater] version ${info.version} downloaded and ready`);
    if (!win.isDestroyed()) {
      win.webContents.send("update-downloaded", { version: info.version });
    }
  });

  // Refuse loudly rather than calling into an install that cannot run. The
  // previous handler always called quitAndInstall(), which on a build with
  // nothing installable returns false internally and resolves the renderer's
  // promise as though the install had been accepted.
  ipcMain.handle("update:install", () => {
    if (capability.mode !== "auto") {
      const message = `Cannot install an update: ${describe(capability)}`;
      console.error(`[updater] ${message}`);
      throw new Error(message);
    }
    autoUpdater.quitAndInstall();
  });

  if (capability.mode === "off") {
    console.info(`[updater] update check skipped: ${describe(capability)}`);
    return capability;
  }

  console.info(`[updater] checking for updates: ${describe(capability)}`);
  autoUpdater
    .checkForUpdates()
    .then((result) => {
      // A null result means the library declined the check; otherwise report
      // what the channel is actually offering, so "no update" and "never
      // asked" are distinguishable in the log.
      if (result == null) {
        console.warn("[updater] update check returned no result");
      } else {
        console.info(
          `[updater] latest published version is ${result.updateInfo.version}`,
        );
      }
    })
    .catch((err: Error) => {
      console.error(
        "[updater] update check failed:",
        err?.stack || err?.message || err,
      );
    });

  return capability;
}
