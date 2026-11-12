"use client";

/**
 * @module DroneVisionTab
 * @description The per-drone Perception node-detail surface. Visible only when
 * the drone runs a companion agent. Organized top-to-bottom into labelled
 * sections so an operator reads it in one pass:
 *   - Engine     — the live engine summary + running-model count;
 *   - Execution  — where detection runs (local NPU vs offloaded), with the pin;
 *   - Feed health— the perception session state + core/NPU usage;
 *   - Inputs     — the node's cameras and which pipeline reads which;
 *   - Models     — the model registry (registry + installed + cache).
 * The live detection preview is the cockpit's Vision view (video, detection
 * list, model picker, depth and surfaces layers); this tab manages the models.
 *
 * Every readout is honest (no fabricated reading): a metric with no real source is hidden
 * (the NPU bar, per-model throughput, feed age) rather than shown as a
 * fabricated zero — that discipline lives in the composed cards themselves.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Eye, HelpCircle, Sparkles } from "lucide-react";
import { VisionSummaryCard } from "@/components/vision/VisionSummaryCard";
import { VisionModelCountTile } from "@/components/vision/VisionModelCountTile";
import { PerceptionUsageCard } from "@/components/vision/PerceptionUsageCard";
import { VisionPipelinesPanel } from "@/components/vision/VisionPipelinesPanel";
import { VisionInputsPanel } from "@/components/vision/VisionInputsPanel";
import { PerceptionTierCard } from "@/components/vision/PerceptionTierCard";
import { PerceptionSessionCard } from "@/components/vision/PerceptionSessionCard";
import { ModelPicker } from "@/components/vision/ModelPicker";
import {
  useAgentCapabilitiesStore,
  selectDeviceCapabilities,
} from "@/stores/agent-capabilities-store";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { connectVisionDetections } from "@/lib/agent/vision-detections-ws";
import { isDemoMode } from "@/lib/utils";

interface DroneVisionTabProps {
  droneId: string;
  /** The node's agent device id (or a relayed drone's peer id). The detection
   * feed and the engine gate resolve from this node, not from the focused-node
   * store. */
  nodeDeviceId: string | null;
}

export function DroneVisionTab({ droneId, nodeDeviceId }: DroneVisionTabProps) {
  const t = useTranslations("vision");
  // The detection feed and the engine gate come from THIS node's agent, never
  // from whichever node's connection happens to be attached.
  const direct = useNodeDirectAgent(nodeDeviceId);
  const agentUrl = direct?.agentUrl ?? null;
  const apiKey = direct?.apiKey ?? null;
  // Whether a vision engine is active on this companion: unknown while this
  // browser has no capability report for the node (unreachable), which is not
  // "off". Only a known-off engine gets the set-up banner.
  const visionState = useAgentCapabilitiesStore((s) => {
    const caps = selectDeviceCapabilities(s, nodeDeviceId);
    if (!caps) return "unknown" as const;
    return caps.visionAvailable === true ? ("on" as const) : ("off" as const);
  });

  // Live detection feed for the engine and session cards. Connect while this
  // tab is mounted and tear the socket down on unmount or when the agent
  // connection changes.
  useEffect(() => {
    if (!agentUrl) return;
    const conn = connectVisionDetections({ droneId, agentUrl, apiKey });
    return () => conn.close();
  }, [droneId, agentUrl, apiKey]);

  // Demo mode: feed the synthetic detection stream into the store (the same
  // seam the live feed uses) so the perception session card shows a real
  // batches/sec for the selected drone with no agent.
  useEffect(() => {
    if (!isDemoMode() || !droneId) return;
    let active = true;
    let stream: { start: (id: string) => void; stop: () => void } | undefined;
    import("@/mock/mock-detections").then((mod) => {
      if (!active) return;
      stream = mod.mockDetectionStream;
      stream.start(droneId);
    });
    return () => {
      active = false;
      stream?.stop();
    };
  }, [droneId]);

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <Eye size={15} className="text-accent-primary" />
        <h2 className="text-sm font-semibold text-text-primary">
          {t("title")}
        </h2>
      </div>
      <p className="mb-4 text-xs text-text-tertiary">{t("subtitle")}</p>

      {visionState === "unknown" && (
        <div
          className="mb-4 flex items-start gap-2.5 rounded border border-border-default bg-bg-secondary p-3"
          data-testid="vision-unknown"
        >
          <HelpCircle size={15} className="mt-0.5 flex-none text-text-tertiary" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-text-primary">{t("stateUnknownTitle")}</p>
            <p className="mt-1 text-[11px] leading-snug text-text-secondary">{t("stateUnknownBody")}</p>
          </div>
        </div>
      )}

      {visionState === "off" && (
        <div
          className="mb-4 flex items-start gap-2.5 rounded border border-accent-primary/40 bg-accent-primary/5 p-3"
          data-testid="vision-onboarding"
        >
          <Sparkles
            size={15}
            className="mt-0.5 flex-none text-accent-primary"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs font-semibold text-text-primary">
              {t("notActiveTitle")}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-text-secondary">
              {t("notActiveBody")}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Section title={t("sectionEngine")}>
            <VisionSummaryCard droneId={droneId} nodeDeviceId={nodeDeviceId} />
            <VisionModelCountTile droneId={droneId} agent={direct} />
          </Section>

          <Section title={t("sectionExecution")}>
            <PerceptionTierCard droneId={droneId} nodeDeviceId={nodeDeviceId} />
          </Section>

          <Section title={t("sectionHealth")}>
            <PerceptionSessionCard droneId={droneId} nodeDeviceId={nodeDeviceId} />
            <PerceptionUsageCard agent={direct} />
          </Section>

          <Section title={t("sectionInputs")}>
            <VisionPipelinesPanel droneId={droneId} nodeDeviceId={nodeDeviceId} />
            <VisionInputsPanel droneId={droneId} nodeDeviceId={nodeDeviceId} />
          </Section>
        </div>

        <div className="flex flex-col gap-5">
          <Section title={t("sectionModels")}>
            <ModelPicker droneId={droneId} mode="full" />
          </Section>
        </div>
      </div>
    </div>
  );
}

/** A labelled group of Perception cards — one scannable section header over a
 * stack of related cards, so the surface reads top-to-bottom in one pass. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        {title}
      </h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
