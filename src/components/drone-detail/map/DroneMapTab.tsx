"use client";

/**
 * @module drone-detail/map/DroneMapTab
 * @description The node-detail Map tab: Navigation's map status card beside
 * the live map, in 2D (the local-frame map the cockpit minimap uses in its
 * local mode, with the `map.overlay` slot over it, so an extension's layer
 * such as Capture's coverage renders in the map's frame) or 3D (the live
 * sweep cloud). The view choice is kept per drone for the session.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import { LocalFrameMap } from "@/components/map/local/LocalFrameMap";
import { MapStatusCard } from "@/components/drone-detail/map/MapStatusCard";
import { mapStatusView } from "@/components/drone-detail/map/map-status-view";
import { PluginSlot } from "@/components/plugins/PluginSlot";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useMapStatusEntry, useNavFeed } from "@/hooks/use-nav-feed";
import { isDemoMode } from "@/lib/utils";
import { NAV_STATE_STALE_MS, freshData, useNavStreamStore } from "@/stores/nav-stream-store";

const LiveSweep3D = dynamic(
  () => import("@/components/drone-detail/map/LiveSweep3D").then((m) => ({ default: m.LiveSweep3D })),
  { ssr: false },
);

export type MapView = "2d" | "3d";

/** The view each drone's Map tab last showed, for the session. */
const viewByDrone = new Map<string, MapView>();

interface DroneMapTabProps {
  droneId: string;
}

export function DroneMapTab({ droneId }: DroneMapTabProps) {
  const t = useTranslations("hud.mapTab");
  const [view, setView] = useState<MapView>(() => viewByDrone.get(droneId) ?? "2d");
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

  const choose = (next: MapView) => {
    viewByDrone.set(droneId, next);
    setView(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium text-text-primary">{t("title")}</h2>
        <SegmentedControl
          size="sm"
          ariaLabel={t("liveMap")}
          value={view}
          onChange={choose}
          options={[
            { value: "2d", label: t("view2d") },
            { value: "3d", label: t("view3d") },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[20rem_1fr]">
        <MapStatusCard view={mapStatusView(entry, now, source)} poseHealth={pose?.health ?? null} />
        <section
          className="relative min-h-[360px] overflow-hidden rounded border border-border-default bg-media"
          aria-label={t("liveMap")}
        >
          {view === "2d" ? (
            <>
              <LocalFrameMap droneId={droneId} className="absolute inset-0" />
              <div data-map-layer="plugin-map-overlay" className="pointer-events-none absolute inset-0 z-[900]">
                <PluginSlot
                  name="map.overlay"
                  className="absolute inset-0"
                  iframeClassName="absolute inset-0 h-full w-full border-0"
                />
              </div>
            </>
          ) : (
            <LiveSweep3D droneId={droneId} pose={pose} />
          )}
        </section>
      </div>
    </div>
  );
}
