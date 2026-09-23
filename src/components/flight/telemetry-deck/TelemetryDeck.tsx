"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useKnownCellCount } from "@/hooks/use-known-cell-count";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneManager } from "@/stores/drone-manager";
import { resolveCellCount } from "@/lib/telemetry/battery-cells";
import {
  useSettingsStore,
  type TelemetryDeckMetricId,
  DEFAULT_TELEMETRY_DECK_PAGES,
} from "@/stores/settings-store";
import { normalizeHeading } from "@/lib/telemetry-utils";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { DeckSeverityContext } from "./deck-types";
import { DECK_PAGE_TABS, DECK_PRESETS, METRIC_LABELS_BY_ID } from "./deck-constants";
import {
  getSeverity,
  estimateFlightMinutes,
  gpsFixKey,
  trackSeverity,
  type SeverityTrack,
} from "./deck-utils";
import { DeckCell } from "./DeckCell";
import { DeckCustomizer } from "./DeckCustomizer";
import { DetachedDeckPortal } from "./DetachedDeckPortal";

/** `value` to `digits` places plus `unit`, or "--" when there is no reading. */
function fixed(value: number | undefined, digits: number, unit = ""): string {
  return value === undefined || !Number.isFinite(value) ? "--" : `${value.toFixed(digits)}${unit}`;
}

/** A 000-359 bearing, or "--" when there is no reading. */
function bearing3(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? "--"
    : `${String(Math.round(normalizeHeading(value))).padStart(3, "0")}°`;
}

interface TelemetryDeckSlots {
  /** Buttons (customize, expand/collapse, detach) — place inside the status bar flex row. */
  controls: React.ReactNode;
  /** Expandable deck panel — place as a full-width sibling below the status bar. */
  panel: React.ReactNode;
}

export function useTelemetryDeck(): TelemetryDeckSlots {
  // Every channel is its fresh sample or undefined. The ring buffers keep the
  // last sample forever, so an ungated deck kept RSSI, BAT V and ROLL in
  // "normal" styling after the telemetry radio died, and showed wings-level
  // zeros before the first ATTITUDE. Absent reads "--" and carries no
  // threshold verdict.
  const pos = useFreshTelemetry("position");
  const vfr = useFreshTelemetry("vfr");
  const bat = useFreshTelemetry("battery");
  const gps = useFreshTelemetry("gps");
  const att = useFreshTelemetry("attitude");
  const wind = useFreshTelemetry("wind");
  const radio = useFreshTelemetry("radio");
  const nav = useFreshTelemetry("navController");
  const ekf = useFreshTelemetry("ekf");
  const vibration = useFreshTelemetry("vibration");
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const knownCellCount = useKnownCellCount(selectedDroneId, bat?.cellCount);
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
  const thresholdRef = useRef<Partial<Record<TelemetryDeckMetricId, SeverityTrack>>>({});
  const { toast } = useToast();
  const tFix = useTranslations("indicators.gpsFix");

  const heading = pos?.heading ?? vfr?.heading;
  // Undefined until a GPS message arrives. "0 SATS" reads as a receiver that
  // has locked onto nothing, which is a different claim from having no fix
  // report at all, and it trips the low-satellite alarm. Fix type carries the
  // same problem: 0 is "No Fix", which is below the critical threshold.
  const fixType = gps?.fixType;
  const satellites = gps?.satellites;
  const hdop = gps?.hdop;
  // -1 is the FC's "capacity unknown", not an empty pack.
  const remainingPct = bat !== undefined && bat.remaining >= 0 ? bat.remaining : undefined;
  const powerWatts = bat?.current !== undefined ? bat.voltage * bat.current : undefined;
  const estimatedMinutes =
    bat?.current !== undefined && bat.consumed !== undefined && remainingPct !== undefined
      ? estimateFlightMinutes(remainingPct, bat.consumed, bat.current)
      : undefined;
  const cellCount = resolveCellCount(bat?.cellVoltages, knownCellCount);
  const severityContext: DeckSeverityContext = useMemo(() => ({ cellCount }), [cellCount]);

  // Samples are buffered but none of the deck's core channels is fresh: the
  // link has gone silent, and the operator has to be told why it all reads "--".
  const buffers = useTelemetryStore.getState();
  const linkSilent =
    pos === undefined &&
    vfr === undefined &&
    att === undefined &&
    bat === undefined &&
    (buffers.position.latest() !== undefined ||
      buffers.vfr.latest() !== undefined ||
      buffers.attitude.latest() !== undefined ||
      buffers.battery.latest() !== undefined);

  const activePageMetrics = telemetryDeckPages[telemetryDeckActivePage] ?? [];

  useEffect(() => {
    if (activePageMetrics.length > 0) return;
    setTelemetryDeckPageMetrics(telemetryDeckActivePage, [...DEFAULT_TELEMETRY_DECK_PAGES[telemetryDeckActivePage]]);
  }, [activePageMetrics.length, setTelemetryDeckPageMetrics, telemetryDeckActivePage]);

  const deckMetricValues = useMemo<Record<TelemetryDeckMetricId, string>>(
    () => ({
      relAlt: fixed(pos?.relativeAlt, 1, "m"),
      airspeed: fixed(vfr?.airspeed ?? pos?.airSpeed, 1, "m/s"),
      groundspeedMs: fixed(pos?.groundSpeed ?? vfr?.groundspeed, 1, "m/s"),
      throttle: fixed(vfr?.throttle, 0, "%"),
      climbRate: fixed(vfr?.climb ?? pos?.climbRate, 1, "m/s"),
      gpsFix: fixType != null ? tFix(gpsFixKey(fixType)) : "--",
      satellites: satellites != null ? `${satellites}` : "--",
      gpsHdop: hdop != null ? hdop.toFixed(1) : "--",
      batteryVoltage: fixed(bat?.voltage, 1, "V"),
      batteryCurrent: fixed(bat?.current, 1, "A"),
      batteryConsumed: fixed(bat?.consumed, 0, "mAh"),
      roll: fixed(att?.roll, 1, "°"),
      pitch: fixed(att?.pitch, 1, "°"),
      yaw: bearing3(att?.yaw ?? heading),
      wpDistance: fixed(nav?.wpDist, 0, "m"),
      xtrackError: fixed(nav?.xtrackError, 1, "m"),
      altError: fixed(nav?.altError, 1, "m"),
      navBearing: bearing3(nav?.navBearing),
      targetBearing: bearing3(nav?.targetBearing),
      windSpeed: fixed(wind?.speed, 1, "m/s"),
      windDirection: bearing3(wind?.direction),
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
      powerWatts: fixed(powerWatts, 0, "W"),
      estFlightMin: fixed(estimatedMinutes, 1, "m"),
      ekfVelRatio: fixed(ekf?.velocityVariance, 2),
      ekfPosHorizRatio: fixed(ekf?.posHorizVariance, 2),
      vibeX: fixed(vibration?.vibrationX, 1),
      vibeY: fixed(vibration?.vibrationY, 1),
      vibeZ: fixed(vibration?.vibrationZ, 1),
    }),
    [att, bat, ekf, estimatedMinutes, fixType, hdop, heading, nav, pos, powerWatts, radio, satellites, tFix, vfr, vibration, wind],
  );

  // Undefined entries are metrics that were never received. They carry no
  // threshold verdict, so an absent link or GPS raises no false alarm.
  const metricRawValues = useMemo<Record<TelemetryDeckMetricId, number | undefined>>(
    () => ({
      relAlt: pos?.relativeAlt,
      airspeed: vfr?.airspeed ?? pos?.airSpeed,
      groundspeedMs: pos?.groundSpeed ?? vfr?.groundspeed,
      throttle: vfr?.throttle,
      climbRate: vfr?.climb ?? pos?.climbRate,
      gpsFix: fixType,
      satellites,
      gpsHdop: hdop,
      batteryVoltage: bat?.voltage,
      batteryCurrent: bat?.current,
      batteryConsumed: bat?.consumed,
      roll: att?.roll,
      pitch: att?.pitch,
      yaw: att?.yaw ?? heading,
      wpDistance: nav?.wpDist,
      xtrackError: nav?.xtrackError,
      altError: nav?.altError,
      navBearing: nav?.navBearing,
      targetBearing: nav?.targetBearing,
      windSpeed: wind?.speed,
      windDirection: wind?.direction,
      radioRssi: radio?.rssi,
      remrssi: radio?.remrssi,
      noise: radio?.noise,
      remnoise: radio?.remnoise,
      rxerrors: radio?.rxerrors,
      txbuf: radio?.txbuf,
      powerWatts,
      estFlightMin: estimatedMinutes,
      ekfVelRatio: ekf?.velocityVariance,
      ekfPosHorizRatio: ekf?.posHorizVariance,
      vibeX: vibration?.vibrationX,
      vibeY: vibration?.vibrationY,
      vibeZ: vibration?.vibrationZ,
    }),
    [att, bat, ekf, estimatedMinutes, fixType, hdop, heading, nav, pos, powerWatts, radio, satellites, vfr, vibration, wind],
  );

  const activeDeckMetricIds = useMemo(
    () => activePageMetrics.filter((id) => Object.prototype.hasOwnProperty.call(deckMetricValues, id)),
    [activePageMetrics, deckMetricValues],
  );

  // Toast on severity transitions that hold for the dwell window, so a value
  // flickering across a band edge (fix type, attitude, climb) is not a toast
  // storm.
  useEffect(() => {
    const now = Date.now();
    for (const metricId of activeDeckMetricIds) {
      const current = getSeverity(metricId, metricRawValues[metricId], severityContext);
      const { track, announce } = trackSeverity(thresholdRef.current[metricId], current, now);
      thresholdRef.current[metricId] = track;
      if (announce) {
        const status = announce === "critical" ? "error" : "warning";
        toast(`${METRIC_LABELS_BY_ID[metricId]} ${announce}: ${deckMetricValues[metricId]}`, status);
      }
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
      {linkSilent && (
        <p
          role="status"
          data-testid="deck-link-silent"
          className="text-[10px] font-mono uppercase tracking-wide text-status-warning"
        >
          Link silent: no live telemetry
        </p>
      )}
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
