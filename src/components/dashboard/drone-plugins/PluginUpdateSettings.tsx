"use client";

/**
 * @module PluginUpdateSettings
 * @description Per-plugin update settings drawer. Shown inside the
 * per-drone Plugins tab when the operator clicks an
 * `<UpdateAvailableBadge>` on a plugin card. Shows the auto-update switch,
 * the version pin, and the last registry sweep the agent reported.
 *
 * Read-only: the agent's auto-update config is edited with the
 * `ados plugin auto-update` CLI on the drone. A value the agent has not
 * reported renders as unknown, never as a default.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePluginUpdateStore } from "@/stores/plugin-update-store";

interface PluginUpdateSettingsProps {
  /** Cloud device id of the drone the plugin is installed on. */
  deviceId: string;
  /** Plugin identifier on the agent. */
  pluginId: string;
  /** Display name to render in the drawer title. */
  pluginName: string;
  /** Version currently running on the agent. */
  currentVersion: string;
  /** Whether the agent has auto-update enabled for this plugin; null when the
   * agent has not reported it. */
  autoUpdate: boolean | null;
  /** Whether a version pin holds the plugin; null when not reported. */
  pinned: boolean | null;
  /** Epoch ms the agent last ran its registry sweep; null when not reported. */
  lastUpdateCheckAt: number | null;
  /** Closes the drawer. */
  onClose: () => void;
}

export function PluginUpdateSettings({
  deviceId,
  pluginId,
  pluginName,
  currentVersion,
  autoUpdate,
  pinned,
  lastUpdateCheckAt,
  onClose,
}: PluginUpdateSettingsProps) {
  const t = useTranslations("pluginRegistry.autoUpdate.settings");

  // Surface the pending event for this plugin (if any) so the operator
  // can confirm which version the badge was pointing at. Reading the
  // store inline keeps the drawer reactive when a fresh event arrives
  // mid-session.
  const pending = usePluginUpdateStore((s) =>
    s.pendingUpdates.find(
      (e) => e.deviceId === deviceId && e.pluginId === pluginId,
    ),
  );

  const autoUpdateLabel =
    autoUpdate === null ? t("unknown") : autoUpdate ? t("on") : t("off");
  const pinnedLabel =
    pinned === null ? t("unknown") : pinned ? t("pinned") : t("pinnedVersionAuto");
  const lastCheckedLabel =
    lastUpdateCheckAt === null
      ? t("unknown")
      : new Date(lastUpdateCheckAt).toLocaleString();

  return (
    <div
      data-testid={`plugin-update-settings-${pluginId}`}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md border border-border-default bg-bg-secondary p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text-primary">
              {t("title", { pluginName })}
            </h2>
            <code className="block truncate text-xs text-text-tertiary">
              {pluginId}
            </code>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </header>

        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-text-tertiary">{t("currentVersion")}</dt>
          <dd className="text-text-primary">v{currentVersion}</dd>
          {pending ? (
            <>
              <dt className="text-text-tertiary">{t("latestAvailable")}</dt>
              <dd className="text-status-warning">v{pending.latestVersion}</dd>
            </>
          ) : null}
          <dt className="text-text-tertiary">{t("autoUpdateLabel")}</dt>
          <dd className="text-text-primary">{autoUpdateLabel}</dd>
          <dt className="text-text-tertiary">{t("pinnedVersionLabel")}</dt>
          <dd className="text-text-primary">{pinnedLabel}</dd>
          <dt className="text-text-tertiary">{t("lastCheckedLabel")}</dt>
          <dd className="text-text-primary">{lastCheckedLabel}</dd>
        </dl>

        <p className="mb-3 text-[11px] text-text-tertiary">{t("autoUpdateHint")}</p>

        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
