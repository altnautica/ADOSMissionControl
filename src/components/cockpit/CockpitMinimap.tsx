"use client";

/**
 * @module cockpit/CockpitMinimap
 * @description The cockpit's top-left minimap card. The map is a clean,
 * non-interactive overview (with any extension map overlays); a click opens
 * the full Flight tab. The basemap selector sits behind a layers icon so it
 * never covers the map. On a narrow cockpit the card collapses to a chip that
 * expands it on demand (the container query lives in the cockpit styles).
 * @license GPL-3.0-only
 */

import { memo, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Layers, Map as MapIcon } from "lucide-react";
import { MinimapBasemapSelector } from "@/components/map/MinimapBasemapSelector";
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

function openFlightTab(): void {
  const ui = useUiStore.getState();
  ui.exitImmersiveMode();
  ui.setPendingDetailTab("flight");
}

export const CockpitMinimap = memo(function CockpitMinimap() {
  const t = useTranslations("cockpit");
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="zone tl d-std pointer-events-auto"
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
      <div className="mmap panel">
        <div className="absolute inset-0">
          <OverviewMap compact pluginOverlay />
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
          className="absolute top-1.5 left-1.5 z-[1002]"
          onClick={(e) => e.stopPropagation()}
        >
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
      </div>
    </div>
  );
});
