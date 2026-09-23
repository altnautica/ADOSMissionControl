"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { useVideoStore } from "@/stores/video-store";

/**
 * GCS-side video page. Encoder settings (bitrate, codec, resolution) live on
 * each node and are edited from that node's Video settings; this page only
 * reports what the current stream measured.
 */
export function VideoSection() {
  const t = useTranslations("video");
  const resolution = useVideoStore((s) => s.resolution);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      <Card>
        <div className="space-y-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-text-secondary">{t("currentResolution")}</span>
            <span className="text-xs font-mono text-text-primary">{resolution || "—"}</span>
          </div>
          <p className="text-[10px] text-text-tertiary">{t("encoderSettingsOnNode")}</p>
        </div>
      </Card>
    </div>
  );
}
