/**
 * @module ReviewHeader
 * @description Sticky identity strip for the plugin install review surface.
 * Stacks the identity row (glyph + name + author/version on the left, close X
 * on the right), the consolidated badge row (trust incl. first-party +
 * halves), and a target strip showing where the install is about to land (with
 * a status dot that mirrors the compatibility result). The modal frame hides
 * its own title bar in the review stage so this header carries the close
 * affordance.
 *
 * @license GPL-3.0-only
 */

"use client";

import { Package, X } from "lucide-react";
import { useTranslations } from "next-intl";

import type { InstallManifestSummary } from "../types";
import { PluginBadgeRow } from "@/components/plugins/PluginBadgeRow";
import { resolveNamedIcon, hasNamedIcon } from "@/lib/icons/icon-registry";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<"ok" | "warn" | "fail", string> = {
  ok: "bg-status-success",
  warn: "bg-status-warning",
  fail: "bg-status-error",
};

export function ReviewHeader({
  manifest,
  targetName,
  boardLabel,
  compatible,
  onClose,
}: {
  manifest: InstallManifestSummary;
  targetName: string;
  boardLabel: string;
  compatible: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("pluginInstall.review");
  const statusKey: "ok" | "warn" | "fail" = compatible ? "ok" : "warn";
  const GlyphIcon = resolveNamedIcon(manifest.icon);

  return (
    <div className="sticky top-0 z-10 space-y-2.5 border-b border-border-default/30 bg-bg-secondary px-6 pb-3 pt-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bg-tertiary">
          {hasNamedIcon(manifest.icon) ? (
            <GlyphIcon className="h-5 w-5 text-text-secondary" aria-hidden />
          ) : manifest.name ? (
            <span className="text-lg font-semibold uppercase text-text-secondary">
              {manifest.name.slice(0, 1)}
            </span>
          ) : (
            <Package className="h-5 w-5 text-text-tertiary" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="truncate text-base font-semibold text-text-primary">
            {manifest.name}
          </h3>
          <p className="text-xs text-text-tertiary">
            {manifest.author
              ? t("byAuthorVersion", {
                  author: manifest.author,
                  version: manifest.version,
                })
              : `v${manifest.version}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="ml-1 shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          <X size={16} />
        </button>
      </div>
      <PluginBadgeRow
        signals={manifest.trustSignals}
        halves={manifest.halves}
      />
      <div className="flex items-center gap-2 font-mono text-xs text-text-secondary">
        <span
          className={cn(
            "inline-block h-2 w-2 shrink-0 rounded-full",
            STATUS_DOT[statusKey],
          )}
          aria-hidden
        />
        <span className="truncate">
          {t("installingTo", { drone: targetName, board: boardLabel })}
        </span>
      </div>
    </div>
  );
}
