"use client";

/**
 * @module RadioTab
 * @description Command-tab home for a ground-station node's WFB-ng radio link
 * surface: the topology badge, live link stats and the TX power slider.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { RadioPanel } from "@/components/hardware/RadioPanel";
import { VideoLinkPanel } from "@/components/hardware/VideoLinkPanel";

export function RadioTab() {
  const t = useTranslations("hardware.radio");
  return (
    <div className="flex flex-col gap-3">
      <PageIntro
        title={t("title")}
        description={t("description")}
        trailing={<HintChip>{t("topology.label")}</HintChip>}
      />
      <RadioPanel />
      <VideoLinkPanel />
    </div>
  );
}
