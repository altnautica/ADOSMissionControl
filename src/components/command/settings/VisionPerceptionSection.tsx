"use client";

/**
 * @module command/settings/VisionPerceptionSection
 * @description The node Settings "Perception setup" page: WHAT this drone
 * detects (the engine-wide detector model, via the shared model picker).
 * Renders nothing on any other profile. Where perception executes (offload to
 * a workstation, serving on one) belongs to the World Engine extension.
 *
 * The detector picker needs the node's LAN vision client (model listing,
 * download, and upload are not proxied); a cloud-only session says so
 * instead of rendering a dead picker.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { resolveVisionClient } from "@/lib/vision/resolve-vision-client";
import { ModelPicker } from "@/components/vision/ModelPicker";
import { InfoNote, Section } from "./Section";
import { useNodeDirectAgent } from "./use-node-direct-agent";

interface SectionProps {
  droneId: string;
  /** The node this page is rendered for. The vision client and the model list
   * resolve from THIS node, never the focused connection. */
  nodeDeviceId: string | null;
  profile: NodeProfile;
}

/** The engine-wide model this node runs, through the shared model picker. The
 * picker acts on the attached connection, so it renders only when that
 * connection belongs to THIS node; otherwise this states the requirement
 * instead of rendering another node's models. */
function DroneDetector({ droneId, nodeDeviceId }: Omit<SectionProps, "profile">) {
  const t = useTranslations("nodeSettings");
  const agent = useNodeDirectAgent(nodeDeviceId);
  const client = useMemo(
    () => (agent ? resolveVisionClient(agent.agentUrl, agent.apiKey) : null),
    [agent],
  );

  return (
    <div className="space-y-2">
      <div className="text-xs text-text-secondary">
        {t("perception.detectorTitle")}
      </div>
      <p className="text-[11px] text-text-tertiary">
        {t("perception.detectorHint")}
      </p>
      {client ? (
        <ModelPicker droneId={droneId} mode="compact" hideHeaderLabel />
      ) : (
        <InfoNote>{t("perception.detectorRequiresLan")}</InfoNote>
      )}
    </div>
  );
}

/** The Settings-tab "Perception setup" page: the drone's detector model. */
export function VisionPerceptionSection({ droneId, nodeDeviceId, profile }: SectionProps) {
  const t = useTranslations("nodeSettings");
  if (profile !== "drone") return null;

  return (
    <Section title={t("perception.title")} icon={Layers} blurb={t("perception.blurb")}>
      <DroneDetector droneId={droneId} nodeDeviceId={nodeDeviceId} />
    </Section>
  );
}
