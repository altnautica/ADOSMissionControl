"use client";

/**
 * @module cockpit/CockpitMinimap
 * @description The cockpit's top-left minimap card. In the global frame it is
 * a clean, non-interactive tile overview (with any extension map overlays and
 * the follow target placed about the EKF origin) and a click opens the full
 * Flight tab; the basemap selector sits behind a
 * layers icon. In the local frame (no GNSS position, an ExternalNav / None
 * horizontal source, or the operator's pin) it draws the north/east local
 * map, which pans and zooms in place. The `AUTO | LOCAL | MAP` toggle is
 * persisted per vehicle. On a narrow cockpit the card collapses to a chip
 * that expands it on demand (the container query lives in the cockpit
 * styles).
 * @license GPL-3.0-only
 */

import { memo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Layers, Map as MapIcon } from "lucide-react";
import { MinimapBasemapSelector } from "@/components/map/MinimapBasemapSelector";
import { LocalFrameMap } from "@/components/map/local/LocalFrameMap";
import { useMinimapFrame } from "@/components/map/local/use-minimap-frame";
import type { MinimapPin } from "@/lib/nav/minimap-mode";
import { useUiStore } from "@/stores/ui-store";

// The minimap is a Leaflet view: load it client-only so the cockpit renders on
// the server without pulling Leaflet into the SSR pass.
const OverviewMap = dynamic(
  () => import("@/components/flight/OverviewMap").then((m) => m.OverviewMap),
  {
    ssr: false,
    loading: () => <div className="w-full h-full bg-media" />,
  },
);
const FollowTargetGeoLayer = dynamic(
  () => import("@/components/map/local/FollowTargetGeoLayer").then((m) => m.FollowTargetGeoLayer),
  { ssr: false },
);

function openFlightTab(): void {
  const ui = useUiStore.getState();
  ui.exitImmersiveMode();
  ui.setPendingDetailTab("flight");
}

const PIN_LABEL = { auto: "modeAuto", local: "modeLocal", map: "modeMap" } as const;

function FrameToggle({ pin, onPin }: { pin: MinimapPin; onPin: (p: MinimapPin) => void }) {
  const t = useTranslations("hud.map");
  return (
    <div className="seg mmap-seg" role="group" aria-label={t("modeLabel")}>
      {(["auto", "local", "map"] as const).map((p) => (
        <button key={p} type="button" aria-pressed={pin === p} onClick={() => onPin(p)}>
          {t(PIN_LABEL[p])}
        </button>
      ))}
    </div>
  );
}

export const CockpitMinimap = memo(function CockpitMinimap({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { frame, pin, setPin } = useMinimapFrame(droneId);
  const toggle = <FrameToggle pin={pin} onPin={setPin} />;

  return (
    <div
      className="zone blc d-std pointer-events-auto"
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="mmap-chip glass-pill"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={t("mapToggle")}
        title={t("mapToggle")}
      >
        <MapIcon size={14} aria-hidden="true" />
      </button>
      <div className="mmap panel" data-frame={frame}>
        {frame === "local" ? (
          <LocalFrameMap droneId={droneId} className="absolute inset-0" headerExtra={toggle} />
        ) : (
          <>
            <div className="absolute inset-0">
              <OverviewMap compact pluginOverlay>
                <FollowTargetGeoLayer droneId={droneId} />
              </OverviewMap>
            </div>
            <button
              type="button"
              onClick={openFlightTab}
              title={t("openFlight")}
              aria-label={t("openFlight")}
              className="absolute inset-0 z-[1001] cursor-pointer transition-colors hover:bg-on-media/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary"
            />
            {/* Above the click overlay; stops clicks falling through to the
                Flight-tab switch. */}
            <div
              className="absolute top-1.5 left-1.5 right-1.5 z-[1002] flex items-start justify-between pointer-events-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative pointer-events-auto">
                <button
                  type="button"
                  onClick={() => setBasemapOpen((o) => !o)}
                  aria-label={t("mapLayer")}
                  aria-expanded={basemapOpen}
                  title={t("mapLayer")}
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-primary/70 text-on-media/80 backdrop-blur-sm transition-colors hover:text-on-media focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                >
                  <Layers size={13} aria-hidden="true" />
                </button>
                {basemapOpen && (
                  <div className="absolute left-0 top-7">
                    <MinimapBasemapSelector className="rounded-md bg-bg-primary/85 p-0.5 backdrop-blur-sm" />
                  </div>
                )}
              </div>
              <div className="pointer-events-auto">{toggle}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});
