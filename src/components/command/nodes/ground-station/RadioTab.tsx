"use client";

/**
 * @module RadioTab
 * @description Command-tab home for a ground-station node's WFB-ng radio link
 * surface: the topology badge, live link stats and the TX power slider. The
 * panels read and write through the focused agent connection, so they render
 * only while that connection serves this node; otherwise one ground station's
 * radio would show (and retune) another's.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { RadioPanel } from "@/components/hardware/radio/RadioPanel";
import { VideoLinkPanel } from "@/components/hardware/VideoLinkPanel";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";

export interface RadioTabProps {
  /** The node this tab is rendered for. */
  nodeDeviceId: string | null;
}

export function RadioTab({ nodeDeviceId }: RadioTabProps) {
  const t = useTranslations("hardware.radio");
  const direct = useNodeDirectAgent(nodeDeviceId);
  return (
    <div className="flex flex-col gap-3">
      <PageIntro
        title={t("title")}
        description={t("description")}
        trailing={<HintChip>{t("topology.label")}</HintChip>}
      />
      {direct === null ? (
        <CloudModeLimitedNotice feature="radio" />
      ) : (
        <>
          <RadioPanel />
          <VideoLinkPanel />
        </>
      )}
    </div>
  );
}
