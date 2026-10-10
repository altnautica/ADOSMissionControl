"use client";

/**
 * @module plugins/PluginSettingsSections
 * @description Renders an installed extension's `gcs.contributes.settings[]`
 * sections with the native parameter renderer, for the extension's detail
 * page. The sections come from the node's own manifest detail
 * (`GET /api/plugins/{id}`) over its LAN or ground-station reach; their
 * values are the plugin's per-drone config on that node, so a GCS-level
 * install (no node) has nothing to render. Renders nothing until a section
 * with parameters is known.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import {
  parseSettingsContributions,
  type ParsedSettingsContribution,
} from "@/lib/plugins/contributions/parse";
import {
  pluginClientForReach,
  resolveNodeAgentReach,
} from "@/lib/plugins/node-agent-reach";
import { PluginParametersPanel } from "./parameters/PluginParametersPanel";

export function PluginSettingsSections({
  deviceId,
  pluginId,
}: {
  /** Bare device id of the node the extension is installed on. */
  deviceId: string | null;
  pluginId: string;
}) {
  const [sections, setSections] = useState<ParsedSettingsContribution[]>([]);

  useEffect(() => {
    setSections([]);
    if (!deviceId) return;
    const reach = resolveNodeAgentReach(deviceId);
    if (!reach) return;
    let alive = true;
    pluginClientForReach(reach)
      .get(pluginId)
      .then((detail) => {
        if (!alive) return;
        const parsed = parseSettingsContributions(detail.manifest.gcs?.contributes.settings) ?? [];
        setSections(
          parsed
            .filter((s) => (s.parameters?.length ?? 0) > 0)
            .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
        );
      })
      .catch(() => {
        // The node's manifest detail is unreadable: no sections to show.
      });
    return () => {
      alive = false;
    };
  }, [deviceId, pluginId]);

  if (!deviceId || sections.length === 0) return null;
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section
          key={section.id}
          className="rounded-md border border-border-default bg-bg-secondary p-3"
        >
          {section.title ? (
            <h3 className="mb-2 text-sm font-semibold text-text-primary">{section.title}</h3>
          ) : null}
          <PluginParametersPanel
            droneId={deviceId}
            pluginId={pluginId}
            parameters={section.parameters ?? []}
          />
        </section>
      ))}
    </div>
  );
}
