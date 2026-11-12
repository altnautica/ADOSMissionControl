/**
 * @module AboutSection
 * @description The desktop app's About block on the Settings page: a "Check
 * for updates" row that asks the main process to query the release channel
 * now, instead of only at startup. What the check finds also reaches the
 * update banner, which owns download and install. Every build shows the app
 * version and a link to the third-party licences; the update row is
 * desktop-only.
 * @license GPL-3.0-only
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import type { ElectronUpdateStatus } from "@/types/electron";
import { usePlatform } from "@/hooks/use-platform";
import { APP_VERSION } from "@/lib/app-version";

const THIRD_PARTY_URL = "https://github.com/altnautica/ADOSMissionControl/network/dependencies";

type CheckResult =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; status: ElectronUpdateStatus }
  | { kind: "failed"; message: string };

export function AboutSection(): React.ReactElement {
  const t = useTranslations("desktopUpdate");
  const { isElectron } = usePlatform();
  const [result, setResult] = useState<CheckResult>({ kind: "idle" });

  const check = () => {
    const updates = window.electronAPI?.updates;
    if (!updates) return;
    setResult({ kind: "checking" });
    updates.check().then(
      (status) => setResult({ kind: "done", status }),
      (err: unknown) =>
        setResult({ kind: "failed", message: err instanceof Error ? err.message : String(err) }),
    );
  };

  let line: string | null = null;
  if (result.kind === "failed") {
    line = t("checkFailed", { message: result.message });
  } else if (result.kind === "done") {
    const s = result.status;
    if (s.state === "idle") line = t("upToDate");
    else if (s.state === "available") line = t("available", { version: s.version });
    else if (s.state === "downloading") line = t("downloading", { version: s.version });
    else if (s.state === "downloaded") line = t("ready", { version: s.version });
    else if (s.state === "check-failed") line = t("checkFailed", { message: s.message });
    else line = t("failed", { message: s.message });
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-medium text-text-primary">{t("aboutTitle")}</h3>
      </div>
      <div className="flex items-center justify-between gap-3 p-3 mb-2 border border-border-default bg-bg-secondary rounded-sm">
        <span className="text-[11px] text-text-secondary">{t("version", { version: APP_VERSION })}</span>
        <a
          href={THIRD_PARTY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-accent-primary hover:underline"
        >
          {t("thirdPartyNotices")}
        </a>
      </div>
      {isElectron && (
      <div className="flex items-center justify-between gap-3 p-3 border border-border-default bg-bg-secondary rounded-sm">
        <span className="text-[11px] text-text-secondary" role="status">
          {line ?? t("checkDescription")}
        </span>
        <button
          type="button"
          onClick={check}
          disabled={result.kind === "checking"}
          className="px-2 py-1 text-[10px] border border-accent-primary/40 hover:bg-accent-primary/20 cursor-pointer flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {result.kind === "checking" ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <RefreshCw size={10} />
          )}
          {result.kind === "checking" ? t("checking") : t("checkForUpdates")}
        </button>
      </div>
      )}
    </div>
  );
}
