"use client";

/**
 * @module command/settings/AtlasSection
 * @description The node Settings "World model" page for a drone. Hosts the
 * World Model master switch (the same feature row the fleet board mounts —
 * it reveals the World Model tabs and enables the native capture service on
 * the node) plus the config-backed pose-source preference.
 *
 * Capability-gated: renders only when the node's own config surface
 * advertises the world-model block, so an agent that predates the feature
 * (or a node with no config path) shows no page. Demo mode renders the page
 * so the feature flow stays exercisable offline.
 *
 * Capture profile and reconstruction detail are shown read-only here — the
 * World Model tab owns those writes (next to the capture controls), and this
 * page never runs a second writer for the same keys.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { WorldModelFeatureRow } from "@/components/features/WorldModelFeatureRow";
import { isDemoMode } from "@/lib/utils";
import { ConfigSelectField, ConfigReadonlyRow } from "./ConfigFields";
import { configAdvertises } from "./use-node-config";
import { Section } from "./Section";

interface SectionProps {
  droneId: string;
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

export function AtlasSection({
  droneId,
  profile,
  config,
  readOnly,
  setValue,
}: SectionProps) {
  const t = useTranslations("nodeSettings.atlas");

  // The world-model capture service is a drone opt-in (a workstation is the
  // reconstructor and treats it as built-in), and the page exists only when
  // the node's config surface advertises the block.
  if (profile !== "drone") return null;
  if (!configAdvertises(config, "atlas") && !isDemoMode()) return null;

  const captureProfileLabels: Record<string, string> = {
    orbit: t("profileOrbit"),
    lawnmower: t("profileLawnmower"),
    freeform: t("profileFreeform"),
    inspection: t("profileInspection"),
  };
  const poseTierOptions = [
    { value: "auto", label: t("poseTierAuto") },
    { value: "local", label: t("poseTierLocal") },
    { value: "offload", label: t("poseTierOffload") },
    { value: "hybrid", label: t("poseTierHybrid") },
  ];

  return (
    <Section title={t("title")} icon={Boxes} blurb={t("blurb")}>
      {/* Master switch — the shared feature row (honest about a node it
          cannot reach; enables the native capture service on toggle). */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-text-primary">
            {t("featureLabel")}
          </div>
          <p className="mt-0.5 text-[11px] text-text-tertiary">
            {t("featureHint")}
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          <WorldModelFeatureRow droneId={droneId} />
        </div>
      </div>

      {/* Pose source — a config-backed preference with no other writer. */}
      <div className="border-t border-border-default pt-3">
        <ConfigSelectField
          configKey="atlas.pose_tier"
          label={t("poseTierLabel")}
          hint={t("poseTierHint")}
          options={poseTierOptions}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      </div>

      {/* Capture tuning — read-only; the World Model tab owns these writes
          (next to the capture controls), so this page never runs a second
          writer for the same keys. */}
      <div className="space-y-2 border-t border-border-default pt-3">
        <ConfigReadonlyRow
          configKey="atlas.capture_profile"
          label={t("captureProfileLabel")}
          config={config}
          format={(raw) =>
            typeof raw === "string" && raw.length > 0
              ? (captureProfileLabels[raw] ?? raw)
              : null
          }
        />
        <ConfigReadonlyRow
          configKey="atlas.reconstruct_steps"
          label={t("reconstructStepsLabel")}
          config={config}
        />
        <p className="text-[11px] text-text-tertiary">
          {t("captureManagedHint")}
        </p>
      </div>
    </Section>
  );
}
