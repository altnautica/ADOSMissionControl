"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Camera } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useVideoStore } from "@/stores/video-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useFleetDrones } from "@/stores/node-registry/use-fleet-drones";
import { useUiStore } from "@/stores/ui-store";

/**
 * GCS-side video page. Encoder settings (bitrate, codec, resolution) live on
 * each node and are edited from that node's Agent › Cameras; this page
 * reports what the current stream measured and leads to that page for the
 * selected drone.
 */
export function VideoSection() {
  const t = useTranslations("video");
  const router = useRouter();
  const resolution = useVideoStore((s) => s.resolution);
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const droneName = useFleetDrones((drones) =>
    droneId ? (drones.find((d) => d.id === droneId)?.name ?? null) : null,
  );

  const openCameras = () => {
    const ui = useUiStore.getState();
    ui.setPendingDetailTab("agent");
    ui.setPendingAgentPanel("cameras");
    router.push("/");
  };

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
          {droneId && droneName ? (
            <Button variant="secondary" size="sm" icon={<Camera size={12} />} onClick={openCameras}>
              {t("openCameras", { drone: droneName })}
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
