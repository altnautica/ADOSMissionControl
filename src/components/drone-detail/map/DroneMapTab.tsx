"use client";

/**
 * @module drone-detail/map/DroneMapTab
 * @description The node-detail Map tab: the world-engine map status card,
 * a launcher for the extension's 3D viewer (its `live-world` Agent page) and
 * the live local-frame map at panel size, the same renderer the cockpit
 * minimap uses in its local mode.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Box } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LocalFrameMap } from "@/components/map/local/LocalFrameMap";
import { MapStatusCard } from "@/components/drone-detail/map/MapStatusCard";
import { mapStatusView } from "@/components/drone-detail/map/map-status-view";
import {
  pluginPageId,
  type AgentNavContribution,
} from "@/components/dashboard/node-detail/surface-types";
import { useMapStatusEntry, useNavFeed } from "@/hooks/use-nav-feed";
import { WORLD_ENGINE_PLUGIN_ID } from "@/lib/api/agent/sensors";
import { isDemoMode } from "@/lib/utils";
import { NAV_STATE_STALE_MS, freshData, useNavStreamStore } from "@/stores/nav-stream-store";
import { useUiStore } from "@/stores/ui-store";

/** The world-engine Agent page that hosts its 3D viewer. */
export const WORLD_VIEWER_PANEL_ID = "live-world";

interface DroneMapTabProps {
  droneId: string;
  pluginAgentPages: ReadonlyArray<AgentNavContribution>;
}

function openViewer(): void {
  const ui = useUiStore.getState();
  ui.setPendingDetailTab("agent");
  ui.setPendingAgentPanel(pluginPageId(WORLD_ENGINE_PLUGIN_ID, WORLD_VIEWER_PANEL_ID));
}

export function DroneMapTab({ droneId, pluginAgentPages }: DroneMapTabProps) {
  const t = useTranslations("hud.mapTab");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Demo mode: run the synthetic feed (detections + nav: pose, scan, occupancy,
  // map status) for this drone, as the Perception tab does, so the card and
  // the live map show data with no agent. Never imported outside demo.
  useEffect(() => {
    if (!isDemoMode() || !droneId) return;
    let active = true;
    let stream: { start: (id: string) => void; stop: () => void } | undefined;
    void import("@/mock/mock-detections").then((mod) => {
      if (!active) return;
      stream = mod.mockDetectionStream;
      stream.start(droneId);
    });
    return () => {
      active = false;
      stream?.stop();
    };
  }, [droneId]);
  const entry = useMapStatusEntry(droneId);
  // The LAN nav-stream entry runs at 1 Hz and goes stale sooner than the
  // heartbeat slice relayed through the cloud.
  const streamEntry = useNavStreamStore((s) => s.byDrone[droneId]?.map);
  const source = entry && entry === streamEntry ? "stream" : "heartbeat";
  const poseEntry = useNavFeed(droneId)?.pose;
  const pose = freshData(poseEntry, now, NAV_STATE_STALE_MS);
  const viewerInstalled = pluginAgentPages.some(
    (p) => p.pluginId === WORLD_ENGINE_PLUGIN_ID && p.panelId === WORLD_VIEWER_PANEL_ID,
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium text-text-primary">{t("title")}</h2>
        <div className="flex items-center gap-2">
          {!viewerInstalled && <span className="text-xs text-text-secondary">{t("viewerUnavailable")}</span>}
          <Button
            variant="secondary"
            size="sm"
            onClick={openViewer}
            disabled={!viewerInstalled}
            title={viewerInstalled ? t("openViewer") : t("viewerUnavailable")}
            icon={<Box size={14} aria-hidden="true" />}
          >
            {t("openViewer")}
          </Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[20rem_1fr]">
        <MapStatusCard view={mapStatusView(entry, now, source)} poseHealth={pose?.health ?? null} />
        <section
          className="relative min-h-[360px] overflow-hidden rounded border border-border-default bg-media"
          aria-label={t("liveMap")}
        >
          <LocalFrameMap droneId={droneId} className="absolute inset-0" />
        </section>
      </div>
    </div>
  );
}
