"use client";

/**
 * @module plugins/DronePluginParametersSection
 * @description The node Extensions page's Parameters section: one card per
 * installed extension that declares parameters, rendering the native
 * schema-driven panel. Independent of tabs, so an extension that contributes
 * parameters but no tab (or only cockpit surfaces) is configurable here.
 * Renders nothing when no installed extension declares parameters.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { useDronePluginParameters } from "@/hooks/use-drone-plugin-contributions";
import { PluginParametersPanel } from "./parameters/PluginParametersPanel";

export function DronePluginParametersSection({ agentId }: { agentId: string }) {
  const t = useTranslations("dronePlugins");
  const plugins = useDronePluginParameters(agentId);
  if (plugins.length === 0) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary">
        {t("parametersSectionTitle")}
      </h3>
      {plugins.map((p) => (
        <div
          key={p.pluginId}
          className="rounded-lg border border-border-default bg-bg-secondary p-3"
        >
          <h4 className="mb-2 text-xs font-semibold text-text-primary">{p.title}</h4>
          <PluginParametersPanel
            droneId={agentId}
            pluginId={p.pluginId}
            parameters={p.parameters}
          />
        </div>
      ))}
    </section>
  );
}
