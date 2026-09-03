"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useDroneStore } from "@/stores/drone-store";
import {
  useSettingsStore,
  type TelemetryDeckMetricId,
  DEFAULT_TELEMETRY_DECK_PAGES,
} from "@/stores/settings-store";
import { normalizeHeading } from "@/lib/telemetry-utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { DeckSeverity, DeckSeverityContext } from "./deck-types";
import { DECK_PAGE_TABS, DECK_PRESETS, METRIC_LABELS_BY_ID } from "./deck-constants";
import { getSeverity, estimateFlightMinutes, gpsFixKey, deriveCellCount } from "./deck-utils";
import { DeckCell } from "./DeckCell";
import { DeckCustomizer } from "./DeckCustomizer";
import { DetachedDeckPortal } from "./DetachedDeckPortal";

interface TelemetryDeckSlots {
  /** Buttons (customize, expand/collapse, detach) — place inside the status bar flex row. */
  controls: React.ReactNode;
  /** Expandable deck panel — place as a full-width sibling below the status bar. */
  panel: React.ReactNode;
}

export function useTelemetryDeck(): TelemetryDeckSlots {
  const pos = useTelemetryLatest("position");
  const vfr = useTelemetryLatest("vfr");
  const bat = useTelemetryLatest("battery");
  const gps = useTelemetryLatest("gps");
  const att = useTelemetryLatest("attitude");
  const wind = useTelemetryLatest("wind");
  const radio = useTelemetryLatest("radio");
  const nav = useTelemetryLatest("navController");
  const ekf = useTelemetryLatest("ekf");
  const vibration = useTelemetryLatest("vibration");
  const mode = useDroneStore((s) => s.flightMode);
  const telemetryDeckPages = useSettingsStore((s) => s.telemetryDeckPages);
  const telemetryDeckActivePage = useSettingsStore((s) => s.telemetryDeckActivePage);
  const setTelemetryDeckActivePage = useSettingsStore((s) => s.setTelemetryDeckActivePage);
  const setTelemetryDeckPageMetrics = useSettingsStore((s) => s.setTelemetryDeckPageMetrics);
  const toggleTelemetryDeckPageMetric = useSettingsStore((s) => s.toggleTelemetryDeckPageMetric);
  const moveTelemetryDeckMetric = useSettingsStore((s) => s.moveTelemetryDeckMetric);

  const [deckOpen, setDeckOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draggingMetricId, setDraggingMetricId] = useState<TelemetryDeckMetricId | null>(null);
  const [dragOverMetricId, setDragOverMetricId] = useState<TelemetryDeckMetricId | null>(null);
  const thresholdRef = useRef<Partial<Record<TelemetryDeckMetricId, DeckSeverity>>>({});
  const { toast } = useToast();
  const tFix = useTranslations("indicators.gpsFix");

  const heading = normalizeHeading(pos?.heading ?? vfr?.heading ?? 0);
  // Undefined until a GPS message arrives. "0 SATS" reads as a receiver that
  // has locked onto nothing, which is a different claim from having no fix
  // report at all, and it trips the low-satellite alarm. Fix type carries the
  // same problem: 0 is "No Fix", which is below the critical threshold.
  const fixType = gps?.fixType;
  const satellites = gps?.satellites;
  const hdop = gps?.hdop;
  const powerWatts = (bat?.voltage ?? 0) * (bat?.current ?? 0);
  const estimatedMinutes = estimateFlightMinutes(bat?.remaining ?? 0, bat?.consumed ?? 0, bat?.current ?? 0);
  const cellCount = deriveCellCount(bat?.voltage ?? 0, bat?.cellVoltages);
  const severityContext: DeckSeverityContext = useMemo(() => ({ cellCount }), [cellCount]);

  const activePageMetrics = telemetryDeckPages[telemetryDeckActivePage] ?? [];

  useEffect(() => {
    if (activePageMetrics.length > 0) return;
    setTelemetryDeckPageMetrics(telemetryDeckActivePage, [...DEFAULT_TELEMETRY_DECK_PAGES[telemetryDeckActivePage]]);
  }, [activePageMetrics.length, setTelemetryDeckPageMetrics, telemetryDeckActivePage]);

  const deckMetricValues = useMemo<Record<TelemetryDeckMetricId, string>>(
    () => ({
      relAlt: `${(pos?.relativeAlt ?? 0).toFixed(1)}m`,
      airspeed: `${(vfr?.airspeed ?? pos?.airSpeed ?? 0).toFixed(1)}m/s`,
      groundspeedMs: `${(pos?.groundSpeed ?? vfr?.groundspeed ?? 0).toFixed(1)}m/s`,
      throttle: `${Math.round(vfr?.throttle ?? 0)}%`,
      climbRate: `${(vfr?.climb ?? pos?.climbRate ?? 0).toFixed(1)}m/s`,
      gpsFix: fixType != null ? tFix(gpsFixKey(fixType)) : "--",
      satellites: satellites != null ? `${satellites}` : "--",
      gpsHdop: hdop != null ? hdop.toFixed(1) : "--",
      batteryVoltage: `${(bat?.voltage ?? 0).toFixed(1)}V`,
      batteryCurrent: `${(bat?.current ?? 0).toFixed(1)}A`,
      batteryConsumed: `${Math.round(bat?.consumed ?? 0)}mAh`,
      roll: `${(att?.roll ?? 0).toFixed(1)}°`,
      pitch: `${(att?.pitch ?? 0).toFixed(1)}°`,
      yaw: `${String(Math.round(normalizeHeading(att?.yaw ?? heading))).padStart(3, "0")}°`,
      wpDistance: `${Math.round(nav?.wpDist ?? 0)}m`,
      xtrackError: `${(nav?.xtrackError ?? 0).toFixed(1)}m`,
      altError: `${(nav?.altError ?? 0).toFixed(1)}m`,
      navBearing: `${String(Math.round(normalizeHeading(nav?.navBearing ?? 0))).padStart(3, "0")}°`,
      targetBearing: `${String(Math.round(normalizeHeading(nav?.targetBearing ?? 0))).padStart(3, "0")}°`,
      windSpeed: `${(wind?.speed ?? 0).toFixed(1)}m/s`,
      windDirection: `${String(Math.round(normalizeHeading(wind?.direction ?? 0))).padStart(3, "0")}°`,
      // Every field here comes from one RADIO_STATUS message. With none
      // received the whole group is unknown, so it reads unknown as a group:
      // "0 errors" and "0% buffer" are as much a fabricated reading as "0 dBm",
      // and the buffer figure trips its own critical threshold.
      radioRssi: radio != null ? `${Math.round(radio.rssi)}` : "--",
      remrssi: radio != null ? `${Math.round(radio.remrssi)}` : "--",
      noise: radio != null ? `${Math.round(radio.noise)}` : "--",
      remnoise: radio != null ? `${Math.round(radio.remnoise)}` : "--",
      rxerrors: radio != null ? `${Math.round(radio.rxerrors)}` : "--",
      txbuf: radio != null ? `${Math.round(radio.txbuf)}%` : "--",
      powerWatts: `${powerWatts.toFixed(0)}W`,
      estFlightMin: estimatedMinutes != null ? `${estimatedMinutes.toFixed(1)}m` : "--",
      ekfVelRatio: `${(ekf?.velocityVariance ?? 0).toFixed(2)}`,
      ekfPosHorizRatio: `${(ekf?.posHorizVariance ?? 0).toFixed(2)}`,
      vibeX: `${(vibration?.vibrationX ?? 0).toFixed(1)}`,
      vibeY: `${(vibration?.vibrationY ?? 0).toFixed(1)}`,
      vibeZ: `${(vibration?.vibrationZ ?? 0).toFixed(1)}`,
    }),
    [att, bat, ekf, estimatedMinutes, fixType, hdop, heading, nav, pos, powerWatts, radio, satellites, tFix, vfr, vibration, wind],
  );

  // Undefined entries are metrics that were never received. They carry no
  // threshold verdict, so an absent link or GPS raises no false alarm.
  const metricRawValues = useMemo<Record<TelemetryDeckMetricId, number | undefined>>(
    () => ({
      relAlt: pos?.relativeAlt ?? 0,
      airspeed: vfr?.airspeed ?? pos?.airSpeed ?? 0,
      groundspeedMs: pos?.groundSpeed ?? vfr?.groundspeed ?? 0,
      throttle: vfr?.throttle ?? 0,
      climbRate: vfr?.climb ?? pos?.climbRate ?? 0,
      gpsFix: fixType,
      satellites,
      gpsHdop: hdop,
      batteryVoltage: bat?.voltage ?? 0,
      batteryCurrent: bat?.current ?? 0,
      batteryConsumed: bat?.consumed ?? 0,
      roll: att?.roll ?? 0,
      pitch: att?.pitch ?? 0,
      yaw: normalizeHeading(att?.yaw ?? heading),
      wpDistance: nav?.wpDist ?? 0,
      xtrackError: nav?.xtrackError ?? 0,
      altError: nav?.altError ?? 0,
      navBearing: normalizeHeading(nav?.navBearing ?? 0),
      targetBearing: normalizeHeading(nav?.targetBearing ?? 0),
      windSpeed: wind?.speed ?? 0,
      windDirection: normalizeHeading(wind?.direction ?? 0),
      radioRssi: radio?.rssi,
      remrssi: radio?.remrssi,
      noise: radio?.noise,
      remnoise: radio?.remnoise,
      rxerrors: radio?.rxerrors,
      txbuf: radio?.txbuf,
      powerWatts,
      estFlightMin: estimatedMinutes,
      ekfVelRatio: ekf?.velocityVariance ?? 0,
      ekfPosHorizRatio: ekf?.posHorizVariance ?? 0,
      vibeX: vibration?.vibrationX ?? 0,
      vibeY: vibration?.vibrationY ?? 0,
      vibeZ: vibration?.vibrationZ ?? 0,
    }),
    [att, bat, ekf, estimatedMinutes, fixType, hdop, heading, nav, pos, powerWatts, radio, satellites, vfr, vibration, wind],
  );

  const activeDeckMetricIds = useMemo(
    () => activePageMetrics.filter((id) => Object.prototype.hasOwnProperty.call(deckMetricValues, id)),
    [activePageMetrics, deckMetricValues],
  );

  // Toast on severity transitions
  useEffect(() => {
    for (const metricId of activeDeckMetricIds) {
      const current = getSeverity(metricId, metricRawValues[metricId], severityContext);
      const previous = thresholdRef.current[metricId];
      if (previous !== undefined && previous !== current && current !== "normal") {
        const status = current === "critical" ? "error" : "warning";
        toast(`${METRIC_LABELS_BY_ID[metricId]} ${current}: ${deckMetricValues[metricId]}`, status);
      }
      thresholdRef.current[metricId] = current;
    }
  }, [activeDeckMetricIds, deckMetricValues, metricRawValues, severityContext, toast]);

  const handleToggleCustomize = () => {
    setCustomizeOpen((prev) => {
      const next = !prev;
      if (next) setDeckOpen(true);
      return next;
    });
  };

  const renderDeckPanel = (detached: boolean) => (
    <div className={cn("space-y-2", detached && "h-full flex flex-col")}>
      <div className="space-y-2 min-w-0">
        {/* Page tabs */}
        <div className="space-y-1">
          <p className="text-[9px] font-mono uppercase tracking-wide text-text-tertiary">Pages</p>
          <div className="flex flex-wrap gap-1.5">
            {DECK_PAGE_TABS.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setTelemetryDeckActivePage(page.id)}
                className={cn(
                  "px-2 py-1 text-[10px] rounded border font-mono transition-colors",
                  telemetryDeckActivePage === page.id
                    ? "border-accent-primary/60 bg-accent-primary/15 text-text-primary"
                    : "border-border-default bg-bg-tertiary text-text-tertiary hover:text-text-secondary",
                )}
              >
                {page.label}
              </button>
            ))}
          </div>
        </div>

        {/* Presets */}
        <div className="space-y-1">
          <p className="text-[9px] font-mono uppercase tracking-wide text-text-tertiary">Presets</p>
          <div className="flex flex-wrap items-center gap-1">
            {DECK_PRESETS.map((preset) => {
              const selected =
                preset.metrics.length === activeDeckMetricIds.length &&
                preset.metrics.every((metric, index) => metric === activeDeckMetricIds[index]);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setTelemetryDeckPageMetrics(telemetryDeckActivePage, preset.metrics)}
                  className={cn(
                    "px-2 py-1 text-[9px] rounded border font-mono transition-colors",
                    selected
                      ? "border-status-success/70 bg-status-success/15 text-text-primary"
                      : "border-border-default bg-bg-tertiary text-text-tertiary hover:text-text-secondary",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Metric grid */}
      <div className={cn(detached && "flex-1 min-h-0 overflow-auto pr-1")}>
        <div className="grid grid-cols-4 gap-1.5">
          {activeDeckMetricIds.map((metricId) => {
            const severity = getSeverity(metricId, metricRawValues[metricId], severityContext);
            return (
              <DeckCell
                key={metricId}
                label={METRIC_LABELS_BY_ID[metricId] ?? metricId}
                value={deckMetricValues[metricId]}
                severity={severity}
                isDragging={draggingMetricId === metricId}
                isDragOver={dragOverMetricId === metricId}
                onDragStart={() => setDraggingMetricId(metricId)}
                onDragEnd={() => {
                  setDraggingMetricId(null);
                  setDragOverMetricId(null);
                }}
                onDragOver={() => setDragOverMetricId(metricId)}
                onDrop={() => {
                  if (!draggingMetricId || draggingMetricId === metricId) return;
                  const fromIndex = activeDeckMetricIds.indexOf(draggingMetricId);
                  const toIndex = activeDeckMetricIds.indexOf(metricId);
                  moveTelemetryDeckMetric(telemetryDeckActivePage, fromIndex, toIndex);
                  setDraggingMetricId(null);
                  setDragOverMetricId(null);
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Metric customizer */}
      {customizeOpen && (
        <DeckCustomizer
          activeDeckMetricIds={activeDeckMetricIds}
          onToggleMetric={(metric) => toggleTelemetryDeckPageMetric(telemetryDeckActivePage, metric)}
          onSetMetrics={(metrics) => setTelemetryDeckPageMetrics(telemetryDeckActivePage, metrics)}
          defaultFallbackMetric={DEFAULT_TELEMETRY_DECK_PAGES[telemetryDeckActivePage][0]}
        />
      )}
    </div>
  );

  return {
    controls: (
      <TelemetryDeckControls
        deckOpen={deckOpen}
        customizeOpen={customizeOpen}
        onToggleDeck={() => setDeckOpen((v) => !v)}
        onToggleCustomize={handleToggleCustomize}
        renderDetachedContent={() => renderDeckPanel(true)}
      />
    ),
    panel: (
      <div
        className={cn(
          "transition-all duration-300 ease-out border-t border-border-default bg-bg-primary/30",
          deckOpen ? "max-h-80 opacity-100 overflow-y-auto" : "max-h-0 opacity-0 overflow-hidden",
        )}
      >
        <div className="px-2 py-2 space-y-2">
          {renderDeckPanel(false)}
        </div>
      </div>
    ),
  };
}

/** Inline controls component that wraps DetachedDeckPortal. */
function TelemetryDeckControls({
  deckOpen,
  customizeOpen,
  onToggleDeck,
  onToggleCustomize,
  renderDetachedContent,
}: {
  deckOpen: boolean;
  customizeOpen: boolean;
  onToggleDeck: () => void;
  onToggleCustomize: () => void;
  renderDetachedContent: () => React.ReactNode;
}) {
  return (
    <DetachedDeckPortal renderDetachedContent={renderDetachedContent}>
      {({ detached, open: openDetached, close: closeDetached }) => (
        <>
          <button
            type="button"
            onClick={onToggleCustomize}
            className={cn(
              "p-1 rounded border border-border-default text-text-tertiary hover:text-text-primary transition-colors",
              customizeOpen && "text-accent-primary border-accent-primary/50",
            )}
            title={customizeOpen ? "Hide deck customization" : "Customize expanded telemetry deck"}
            aria-label={customizeOpen ? "Hide deck customization" : "Customize expanded telemetry deck"}
          >
            <SlidersHorizontal size={11} />
          </button>
          <button
            type="button"
            onClick={onToggleDeck}
            className="p-1 rounded border border-border-default text-text-tertiary hover:text-text-primary transition-colors"
            title={deckOpen ? "Collapse expanded telemetry deck" : "Expand telemetry deck"}
            aria-label={deckOpen ? "Collapse expanded telemetry deck" : "Expand telemetry deck"}
          >
            <ChevronDown size={11} className={cn("transition-transform duration-200", deckOpen && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={() => (detached ? closeDetached() : openDetached())}
            className={cn(
              "px-1.5 py-1 rounded border border-border-default text-[10px] font-mono text-text-tertiary hover:text-text-primary transition-colors",
              detached && "text-accent-primary border-accent-primary/50",
            )}
            title={detached ? "Reattach detached telemetry deck" : "Detach telemetry deck"}
            aria-label={detached ? "Reattach detached telemetry deck" : "Detach telemetry deck"}
          >
            {detached ? "ATTACH" : "DETACH"}
          </button>
        </>
      )}
    </DetachedDeckPortal>
  );
}
