/**
 * @module ReviewStage
 * @description Two-column install review surface. Composes the sticky header
 * (identity + badge row), a sticky sub-bar (install destinations + a jump-to
 * permissions pill), the scrolling main column (about / features /
 * contributions / hardware access / permissions / requirements), the right
 * rail (details + compatibility + contents + links + screenshots), and the
 * sticky footer with the CTA pair.
 *
 * The information architecture follows a VS-Code "feature contributions" model
 * with progressive disclosure: what the plugin adds to Mission Control reads
 * first, the permission grant is one click away via the sub-bar pill, and the
 * denser requirement facts sit at the bottom.
 *
 * @license GPL-3.0-only
 */

"use client";

import { ShieldQuestion } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { CapabilityChips } from "@/components/plugins/CapabilityChips";
import { PluginContributions } from "@/components/plugins/contributions/PluginContributions";

import type { InstallManifestSummary } from "../types";
import type { CompatibilityResult } from "../check-compatibility";

import { PermissionsSection } from "./PermissionsSection";
import { AboutSection, FeaturesSection } from "./ReviewAbout";
import { RequirementsSection } from "./ReviewRequirements";
import { ReviewHeader } from "./ReviewHeader";
import { SidebarPanel } from "./SidebarPanel";

const PERMISSIONS_ANCHOR = "plugin-install-permissions";

export interface ReviewStageProps {
  manifest: InstallManifestSummary;
  targetName: string;
  /** Drone the agent half installs on, or null when the plugin has no
   * agent half / is being installed from the no-drone Settings home.
   * Drives the two-destination breakdown. */
  agentTargetName?: string | null;
  boardLabel: string;
  ramTotalMb?: number;
  compatibility: CompatibilityResult;
  granted: Set<string>;
  onTogglePermission: (id: string, required: boolean) => void;
  onCancel: () => void;
  onInstall: () => void;
}

export function ReviewStage({
  manifest,
  targetName,
  agentTargetName,
  boardLabel,
  ramTotalMb,
  compatibility,
  granted,
  onTogglePermission,
  onCancel,
  onInstall,
}: ReviewStageProps) {
  const t = useTranslations("pluginInstall.review");

  const installDisabled = !compatibility.boardCompatible;
  // The footer counts what the operator is actually approving (the granted
  // set). The sub-bar pill counts the full permission surface to review. They
  // are labelled distinctly, and a plugin that grants nothing reads "Install"
  // rather than the confusing "grants 0" next to an "N permissions" pill.
  const grantedCount = granted.size;
  const permissionsTotal = manifest.permissions.length;

  const scrollToPermissions = () => {
    if (typeof document === "undefined") return;
    document
      .getElementById(PERMISSIONS_ANCHOR)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_360px] min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-col overflow-hidden border-r border-border-default/30">
        <ReviewHeader
          manifest={manifest}
          targetName={targetName}
          boardLabel={boardLabel}
          compatible={compatibility.boardCompatible}
          onClose={onCancel}
        />
        <SubBar
          halves={manifest.halves}
          agentTargetName={agentTargetName ?? null}
          permissionsTotal={permissionsTotal}
          onJumpToPermissions={scrollToPermissions}
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-8">
            {manifest.descriptionLong || manifest.description ? (
              <AboutSection
                shortText={manifest.description}
                longText={manifest.descriptionLong}
                title={t("about.title")}
              />
            ) : null}

            {manifest.features && manifest.features.length > 0 && (
              <FeaturesSection
                title={t("features.title")}
                features={manifest.features}
              />
            )}

            <PluginContributions manifest={manifest} />

            <CapabilityChips
              permissions={manifest.permissions}
              vendorAttribution={manifest.vendorAttribution}
              hardwareRequirements={manifest.hardwareRequirements}
              telemetryFields={manifest.telemetryFields}
              title={t("hardwareAccess.title")}
            />

            <section id={PERMISSIONS_ANCHOR} className="scroll-mt-4">
              <PermissionsSection
                manifest={manifest}
                granted={granted}
                onToggle={onTogglePermission}
              />
            </section>

            <RequirementsSection manifest={manifest} />
          </div>
        </div>
        <footer className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t border-border-default/30 bg-bg-secondary px-6 py-4">
          <Button variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            onClick={onInstall}
            disabled={installDisabled}
            title={
              installDisabled ? t("installDisabledNotCompatible") : undefined
            }
          >
            {grantedCount > 0
              ? t("installGrants", { n: grantedCount })
              : t("install")}
          </Button>
        </footer>
      </div>
      <SidebarPanel
        manifest={manifest}
        compatibility={compatibility}
        boardLabel={boardLabel}
        ramTotalMb={ramTotalMb}
      />
    </div>
  );
}

/**
 * Sticky sub-bar below the header: the two-destination breakdown on the left
 * and a "N permissions" pill on the right that jumps to the permissions
 * section so consent is one click away while the operator reads.
 */
function SubBar({
  halves,
  agentTargetName,
  permissionsTotal,
  onJumpToPermissions,
}: {
  halves: ReadonlyArray<"agent" | "gcs">;
  agentTargetName: string | null;
  permissionsTotal: number;
  onJumpToPermissions: () => void;
}) {
  const t = useTranslations("pluginInstall.review");
  const hasAgent = halves.includes("agent");
  const hasGcs = halves.includes("gcs");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 border-b border-border-default/30 bg-bg-tertiary/30 px-6 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {hasAgent && (
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-text-secondary">
              {t("destinations.agentHalf")}
            </span>
            <span className="text-text-tertiary" aria-hidden>
              →
            </span>
            {agentTargetName ? (
              <span className="text-text-primary">{agentTargetName}</span>
            ) : (
              <span className="text-status-warning">
                {t("destinations.perDrone")}
              </span>
            )}
          </span>
        )}
        {hasGcs && (
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-text-secondary">
              {t("destinations.gcsHalf")}
            </span>
            <span className="text-text-tertiary" aria-hidden>
              →
            </span>
            <span className="text-text-primary">
              {t("destinations.thisMissionControl")}
            </span>
          </span>
        )}
      </div>
      {permissionsTotal > 0 && (
        <button
          type="button"
          onClick={onJumpToPermissions}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-default/50 bg-bg-secondary px-2.5 py-1 font-medium text-text-secondary transition-colors hover:border-accent-primary/50 hover:text-text-primary"
        >
          <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />
          {t("permissionsAnchor", { count: permissionsTotal })}
        </button>
      )}
    </div>
  );
}
