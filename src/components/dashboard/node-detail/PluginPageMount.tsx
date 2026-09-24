"use client";

/**
 * @module node-detail/PluginPageMount
 * @description The body of a plugin Agent page or node surface. Looks up the
 * loaded contribution for (install, panel) in the surrounding
 * `PluginHostProvider` and mounts it through `PluginContributionMount`, which
 * owns the capability gate and the iframe / inline branch. Until the bundle is
 * loaded (or when it cannot be) it says so rather than rendering nothing.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useSlotContributions } from "@/components/plugins/PluginHostProvider";
import { PluginContributionMount } from "@/components/plugins/PluginSlot";
import type { PluginSlotName } from "@/lib/plugins/types";

export function PluginPageMount({
  slot,
  installId,
  panelId,
}: {
  slot: Extract<PluginSlotName, "node.agent.page" | "node.surface">;
  installId: string;
  panelId: string;
}) {
  const t = useTranslations("dronePanel.pluginSurface");
  const contribution = useSlotContributions(slot).find(
    (c) => (c.pluginInstallId ?? c.pluginId) === installId && c.panelId === panelId,
  );
  if (!contribution) {
    return (
      <div className="m-3 rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary" role="status">
        {t("unavailable")}
      </div>
    );
  }
  return (
    <PluginContributionMount
      slot={slot}
      contribution={contribution}
      className="flex-1 min-h-0 flex flex-col"
    />
  );
}
