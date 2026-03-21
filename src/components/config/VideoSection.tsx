"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useVideoStore } from "@/stores/video-store";

const OSD_ELEMENT_KEYS = [
  "crosshair",
  "speedTape",
  "altitudeTape",
  "heading",
  "battery",
  "gps",
  "armedStatus",
  "signal",
  "timer",
] as const;

export function VideoSection() {
  const t = useTranslations("video");
  const { resolution } = useVideoStore();
  const [lowLatency, setLowLatency] = useState(true);
  const [bitrate, setBitrate] = useState("4");
  const [codec, setCodec] = useState("h264");
  const [osdState, setOsdState] = useState<Record<string, boolean>>(() => {
    const state: Record<string, boolean> = {};
    for (const el of OSD_ELEMENT_KEYS) {
      state[el] = true;
    }
    return state;
  });

  const toggleOsd = (element: string) => {
    setOsdState((prev) => ({ ...prev, [element]: !prev[element] }));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      <Card>
        <div className="space-y-4">
          <Toggle
            label={t("lowLatency")}
            checked={lowLatency}
            onChange={setLowLatency}
          />

          <Select
            label={t("targetBitrate")}
            value={bitrate}
            onChange={setBitrate}
            options={[
              { value: "2", label: "2 Mbps" },
              { value: "4", label: "4 Mbps" },
              { value: "8", label: "8 Mbps" },
              { value: "12", label: "12 Mbps" },
            ]}
          />

          <Select
            label={t("recordingCodec")}
            value={codec}
            onChange={setCodec}
            options={[
              { value: "h264", label: "H.264" },
              { value: "h265", label: "H.265" },
            ]}
          />

          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-text-secondary">{t("currentResolution")}</span>
            <span className="text-xs font-mono text-text-primary">{resolution}</span>
          </div>
        </div>
      </Card>

      <Card title={t("osdElements")}>
        <div className="space-y-2">
          {OSD_ELEMENT_KEYS.map((element) => (
            <Toggle
              key={element}
              label={t(element)}
              checked={osdState[element]}
              onChange={() => toggleOsd(element)}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
