"use client";

/**
 * @module cockpit/CockpitMinimap
 * @description The map face of the flight screen's bottom-left card. In the
 * global frame it is a clean, non-interactive tile overview (with any
 * extension map overlays and the follow target placed about the EKF origin)
 * and a click opens the full Flight tab; the basemap selector sits behind a
 * layers icon. In the local frame (no GNSS position, an ExternalNav / None
 * horizontal source, or the operator's pin) it draws the north/east local
 * map, which pans and zooms in place. The `AUTO | LOCAL | MAP` toggle is
 * persisted per vehicle. It fills the card it is placed in.
 * @license GPL-3.0-only
 */

import { memo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Layers, Maximize2 } from "lucide-react";
import { MinimapBasemapSelector } from "@/components/map/MinimapBasemapSelector";
import { LocalFrameMap } from "@/components/map/local/LocalFrameMap";
import { FlightSheetPortal } from "@/components/cockpit/flight/flight-sheet";
import { specString } from "@/lib/cockpit/spec-strings";
import { useMinimapFrame } from "@/components/map/local/use-minimap-frame";
import type { MinimapPin } from "@/lib/hud/minimap-mode";
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
// The Fly Here hold-confirm for a point picked on this map (right-click or
// long-press); the compact map does not mount its own.
const GuidedConfirmDialog = dynamic(
  () => import("@/components/flight/GuidedConfirmDialog").then((m) => ({ default: m.GuidedConfirmDialog })),
  { ssr: false },
);

function openFlightTab(): void {
  const ui = useUiStore.getState();
  ui.exitImmersiveMode();
  ui.setPendingDetailTab("flight");
}

function FrameToggle({ pin, onPin }: { pin: MinimapPin; onPin: (p: MinimapPin) => void }) {
  return (
    <div className="seg mmap-seg" role="group" aria-label={specString("minimap.mode_label")}>
      {(["auto", "local", "map"] as const).map((p) => (
        <button key={p} type="button" aria-pressed={pin === p} onClick={() => onPin(p)}>
          {specString(`minimap.pin.${p}`)}
        </button>
      ))}
    </div>
  );
}

export const CockpitMinimap = memo(function CockpitMinimap({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const { frame, pin, setPin } = useMinimapFrame(droneId);
  const toggle = <FrameToggle pin={pin} onPin={setPin} />;

  return (
    <div className="mmap" data-frame={frame} data-testid="cockpit-minimap">
      {frame === "local" ? (
        <LocalFrameMap droneId={droneId} className="absolute inset-0" headerExtra={toggle} compact />
      ) : (
        <>
          {/* The map takes its own pointer input, so a right-click or a
              long-press on it can offer Fly Here; opening the Flight tab is
              the button in the corner. */}
          <div className="absolute inset-0">
            <OverviewMap compact pluginOverlay>
              <FollowTargetGeoLayer droneId={droneId} />
            </OverviewMap>
          </div>
          <div className="absolute top-1.5 left-1.5 right-1.5 z-[1002] flex items-start justify-between pointer-events-none">
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
            <div className="pointer-events-auto flex items-start gap-1">
              {toggle}
              <button
                type="button"
                onClick={openFlightTab}
                data-testid="minimap-open-flight"
                title={t("openFlight")}
                aria-label={t("openFlight")}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-primary/70 text-on-media/80 backdrop-blur-sm transition-colors hover:text-on-media focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
              >
                <Maximize2 size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
      {/* At the flight screen's root: the card is too small to hold it. */}
      <FlightSheetPortal>
        <GuidedConfirmDialog />
      </FlightSheetPortal>
    </div>
  );
});
