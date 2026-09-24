/**
 * @module plugins/contributions/PluginContributions
 * @description The "Adds to Mission Control" block in the install pop-up. It
 * reads the plugin's parsed contributions off the install summary, partitions
 * the slot panels by the surface they land on, and renders each first-class
 * contribution type (skills, tabs/panels, overlays, settings, target actions,
 * map/mission, MCP tools) as its own labeled section. Renders nothing when the
 * plugin contributes no recognized surface.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";

import type { InstallManifestSummary } from "../install-dialog/types";

import { SkillsSection } from "./SkillsSection";
import { ToolsSection } from "./ToolsSection";
import { TabsSection } from "./TabsSection";
import { OverlaysSection } from "./OverlaysSection";
import { ParametersSection } from "./ParametersSection";
import { TargetActionsSection } from "./TargetActionsSection";
import { MapMissionSection } from "./MapMissionSection";

const TAB_SLOTS: ReadonlySet<string> = new Set([
  "node.detail.tab",
  "cockpit.panel",
  "fc.tab",
  "hardware.tab",
  "settings.section",
  "node.agent.page",
  "node.surface",
]);
const OVERLAY_SLOTS: ReadonlySet<string> = new Set([
  "video.overlay",
  "notification.channel",
]);

export function PluginContributions({
  manifest,
}: {
  manifest: InstallManifestSummary;
}) {
  const t = useTranslations("pluginInstall.review.contributions");

  const skills = manifest.contributesSkills ?? [];
  const tools = manifest.contributesTools ?? [];
  const tabs = manifest.contributesTabs ?? [];
  const parameters = manifest.contributesParameters ?? [];
  const targetActions = manifest.contributesTargetActions ?? [];
  const mapOverlays = manifest.contributesMapOverlays ?? [];
  const missionTemplates = manifest.contributesMissionTemplates ?? [];

  const slots = manifest.contributesSlots ?? [];
  const tabSlots = slots.filter((s) => TAB_SLOTS.has(s.slot));
  const overlaySlots = slots.filter((s) => OVERLAY_SLOTS.has(s.slot));
  const mapSlots = slots.filter((s) => s.slot === "map.overlay");
  const missionSlots = slots.filter((s) => s.slot === "mission.template");

  const total =
    skills.length +
    tools.length +
    tabs.length +
    tabSlots.length +
    overlaySlots.length +
    parameters.length +
    targetActions.length +
    mapSlots.length +
    missionSlots.length +
    mapOverlays.length +
    missionTemplates.length;
  if (total === 0) return null;

  return (
    <section>
      <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
        {t("title")}
      </h3>
      <div className="space-y-4">
        <SkillsSection skills={skills} />
        <TabsSection tabs={tabs} panels={tabSlots} />
        <OverlaysSection overlays={overlaySlots} />
        <ParametersSection parameters={parameters} />
        <TargetActionsSection actions={targetActions} />
        <MapMissionSection
          mapSlots={mapSlots}
          missionSlots={missionSlots}
          mapOverlays={mapOverlays}
          missionTemplates={missionTemplates}
        />
        <ToolsSection tools={tools} />
      </div>
    </section>
  );
}
