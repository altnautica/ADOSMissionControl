"use client";

/**
 * @module DemoRegistryGrid
 * @description The demo-mode registry catalog. The live grid is Convex-backed
 * and unreachable under `npm run demo`, so this renders a small fixture of
 * representative extensions and opens the same install / detail pop-up against
 * their parsed manifests — letting the operator explore the full pop-up surface
 * with no backend. Rendered only from `RegistryPluginGrid` when `isDemoMode()`.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { resolveNamedIcon } from "@/lib/icons/icon-registry";
import { PluginInstallDialog } from "@/components/plugins/PluginInstallDialog";
import type {
  InstallManifestSummary,
  InstallSource,
  InstallTargetDrone,
} from "@/components/plugins/install-dialog/types";
import {
  parseManifestYaml,
  toInstallSummary,
} from "@/components/plugins/transports/manifest-parse";
import {
  DEMO_REGISTRY_ENTRIES,
  type DemoRegistryEntry,
} from "@/lib/plugins/first-party-registry";

interface PendingInstall {
  manifest: InstallManifestSummary;
  manifestHash: string;
  source: Extract<InstallSource, { kind: "registry" }>;
}

export function DemoRegistryGrid({
  target = null,
}: {
  target?: InstallTargetDrone | null;
}) {
  const t = useTranslations("pluginRegistry.browse");
  const [pending, setPending] = useState<PendingInstall | null>(null);

  const open = useCallback((entry: DemoRegistryEntry) => {
    const parsed = parseManifestYaml(entry.manifestYaml);
    const manifest = toInstallSummary(parsed, entry.archiveSha256, {
      signerId: entry.signerKeyId,
      archiveSha256: entry.archiveSha256,
    });
    setPending({
      manifest,
      manifestHash: entry.archiveSha256,
      source: {
        kind: "registry",
        url: entry.downloadUrl,
        expectedSha256: entry.archiveSha256,
        pluginId: entry.row.plugin_id,
        version: entry.row.latest_version,
      },
    });
  }, []);

  return (
    <section className="space-y-3">
      <header className="space-y-0.5">
        <h3 className="text-base font-semibold text-text-primary">
          {t("title")}
        </h3>
        <p className="text-xs text-text-tertiary">{t("subtitle")}</p>
      </header>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {DEMO_REGISTRY_ENTRIES.map((entry) => (
          <DemoCard key={entry.row.plugin_id} entry={entry} onOpen={open} />
        ))}
      </ul>
      <PluginInstallDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        targetDevice={target}
        initialManifest={pending?.manifest}
        initialManifestHash={pending?.manifestHash}
        initialSource={pending?.source}
      />
    </section>
  );
}

function DemoCard({
  entry,
  onOpen,
}: {
  entry: DemoRegistryEntry;
  onOpen: (entry: DemoRegistryEntry) => void;
}) {
  const t = useTranslations("pluginRegistry.browse");
  const { row } = entry;
  const Icon = resolveNamedIcon(row.icon);

  return (
    <li className="h-full">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(entry)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(entry);
          }
        }}
        aria-label={t("card.viewDetails")}
        className="flex h-full cursor-pointer flex-col gap-2 rounded-lg border border-border-default bg-bg-secondary p-3 transition-colors hover:border-border-strong hover:bg-bg-tertiary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-accent-primary/40 bg-accent-primary/10 text-accent-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="truncate text-sm font-medium text-text-primary">
                {row.name}
              </h4>
              <span className="text-xs text-text-tertiary">
                v{row.latest_version}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-border-default/50 bg-bg-tertiary/50 px-2 py-0.5 text-[11px] text-text-secondary">
                {t(`category.${row.category}`)}
              </span>
            </div>
          </div>
        </div>
        <p className="line-clamp-2 text-xs text-text-secondary">
          {row.description}
        </p>
        <p className="mt-auto truncate text-[11px] text-text-tertiary">
          {t("card.byAuthor", { author: row.author_id })}
        </p>
      </div>
    </li>
  );
}
