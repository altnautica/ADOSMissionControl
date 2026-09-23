"use client";

/**
 * Desktop-only banner for the app's own updates.
 *
 * The main process checks for a newer release at startup but never downloads
 * one on its own. This banner is where the operator learns a version exists
 * and decides: download and install it where this build can, or open the
 * releases page where it cannot. A failed download or install is shown here
 * instead of disappearing into the main-process log.
 *
 * Renders nothing in a browser build.
 *
 * @module components/layout/DesktopUpdateBanner
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, RotateCw, X } from "lucide-react";
import type { ElectronUpdateStatus } from "@/types/electron";

export function DesktopUpdateBanner(): React.ReactElement | null {
  const t = useTranslations("desktopUpdate");
  const [status, setStatus] = useState<ElectronUpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<ElectronUpdateStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const updates = window.electronAPI?.updates;
    if (!updates) return;
    let live = true;
    const unsubscribe = updates.onStatus((next) => {
      setStatus(next);
      setActionError(null);
    });
    // The startup check can finish before this page mounts; a status pushed
    // after subscribing is newer than the one read back, so it wins.
    void updates.status().then((current) => {
      if (live) setStatus((prev) => prev ?? current);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  const updates = typeof window === "undefined" ? undefined : window.electronAPI?.updates;
  if (!updates || !status || status.state === "idle" || status === dismissed) return null;

  const run = (action: () => Promise<void>) => {
    setActionError(null);
    action().catch((err: unknown) => {
      setActionError(err instanceof Error ? err.message : String(err));
    });
  };

  const dismiss = (
    <button
      onClick={() => setDismissed(status)}
      className="px-2 py-0.5 text-[10px] border border-border-default hover:bg-bg-tertiary cursor-pointer flex items-center gap-1"
    >
      <X size={10} />
      {t("dismiss")}
    </button>
  );

  const failed = status.state === "error" ? status.message : actionError;
  if (failed) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 px-4 py-2 bg-status-error/10 border-b border-status-error/40 text-status-error text-[11px]"
      >
        <span>{t("failed", { message: failed })}</span>
        {dismiss}
      </div>
    );
  }

  const shell =
    "flex items-center justify-between gap-3 px-4 py-2 bg-accent-primary/10 border-b border-accent-primary/40 text-text-primary text-[11px]";
  const button =
    "px-2 py-0.5 text-[10px] border border-accent-primary/40 hover:bg-accent-primary/20 cursor-pointer flex items-center gap-1";

  if (status.state === "available") {
    return (
      <div role="status" className={shell}>
        <span>
          {t("available", { version: status.version })}
          {!status.installable && <> {t("manualOnly")}</>}
        </span>
        <div className="flex items-center gap-2">
          {status.installable ? (
            <button onClick={() => run(updates.download)} className={button}>
              <Download size={10} />
              {t("download")}
            </button>
          ) : (
            <a href={status.releasesUrl} target="_blank" rel="noopener noreferrer" className={button}>
              {t("openReleases")}
            </a>
          )}
          {dismiss}
        </div>
      </div>
    );
  }

  if (status.state === "downloading") {
    return (
      <div role="status" className={shell}>
        <span className="flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" />
          {t("downloading", { version: status.version })}
        </span>
      </div>
    );
  }

  if (status.state !== "downloaded") return null;
  return (
    <div role="status" className={shell}>
      <span>{t("ready", { version: status.version })}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => run(updates.install)} className={button}>
          <RotateCw size={10} />
          {t("install")}
        </button>
        {dismiss}
      </div>
    </div>
  );
}
