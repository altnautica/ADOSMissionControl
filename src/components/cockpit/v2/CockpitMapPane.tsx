"use client";

/**
 * @module cockpit/v2/CockpitMapPane
 * @description The map pane of the cockpit's Map and Split views. It follows
 * the minimap's frame choice: the north/east local map without a global
 * position, otherwise the tile overview with the extension overlays and the
 * follow target. Unlike the minimap it is interactive (pan, zoom) and never
 * opens the Flight tab.
 *
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";

import { LocalFrameMap } from "@/components/map/local/LocalFrameMap";
import { useMinimapFrame } from "@/components/map/local/use-minimap-frame";
import { MissionPlanIdentityBanner } from "@/components/cockpit/v2/MissionPlanIdentityBanner";

const OverviewMap = dynamic(
  () => import("@/components/flight/OverviewMap").then((m) => m.OverviewMap),
  { ssr: false, loading: () => <div className="h-full w-full bg-media" /> },
);
const FollowTargetGeoLayer = dynamic(
  () => import("@/components/map/local/FollowTargetGeoLayer").then((m) => m.FollowTargetGeoLayer),
  { ssr: false },
);

export function CockpitMapPane({ droneId, className }: { droneId: string; className?: string }) {
  const { frame } = useMinimapFrame(droneId);
  return (
    <div className={className} data-testid="cockpit-map-pane" data-frame={frame}>
      {frame === "local" ? (
        <LocalFrameMap droneId={droneId} className="absolute inset-0" />
      ) : (
        <div className="absolute inset-0">
          <OverviewMap pluginOverlay>
            <FollowTargetGeoLayer droneId={droneId} />
          </OverviewMap>
        </div>
      )}
      <MissionPlanIdentityBanner droneId={droneId} className="absolute left-1/2 top-2 z-[1001] -translate-x-1/2" />
    </div>
  );
}
