"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, SlidersHorizontal, GripVertical } from "lucide-react";
import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { useDroneStore } from "@/stores/drone-store";
import {
  useSettingsStore,
  type TelemetryDeckMetricId,
  type TelemetryDeckPageId,
  DEFAULT_TELEMETRY_DECK_PAGES,
} from "@/stores/settings-store";
import { mpsToKph, normalizeHeading } from "@/lib/telemetry-utils";
import { MODE_DESCRIPTIONS } from "@/components/fc/flight-modes/flight-mode-constants";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import type { UnifiedFlightMode } from "@/lib/protocol/types";

type DeckSeverity = "normal" | "warning" | "critical";
type DeckThresholdMode = "lt" | "gt" | "absGt";
type DeckMetricCategory = "Flight" | "Navigation" | "Power" | "GPS" | "Link" | "Wind" | "Tuning";

interface DeckMetricOption {
  id: TelemetryDeckMetricId;
  label: string;
  category: DeckMetricCategory;
}

interface DeckThreshold {
  mode: DeckThresholdMode;
  warning: number;
  critical: number;
}

function syncPopupTheme(targetWindow: Window): void {
  const sourceHtml = document.documentElement;
  const targetHtml = targetWindow.document.documentElement;

  targetHtml.className = sourceHtml.className;
  targetHtml.lang = sourceHtml.lang;
  targetHtml.style.cssText = sourceHtml.style.cssText;

  const sourceDataAttrs = new Set<string>();
  for (const attr of Array.from(sourceHtml.attributes)) {
    if (!attr.name.startsWith("data-")) continue;
    sourceDataAttrs.add(attr.name);
    targetHtml.setAttribute(attr.name, attr.value);
  }

  for (const attr of Array.from(targetHtml.attributes)) {
    if (!attr.name.startsWith("data-")) continue;
    if (!sourceDataAttrs.has(attr.name)) {
      targetHtml.removeAttribute(attr.name);
    }
  }

  const popupBody = targetWindow.document.body;
  popupBody.className = document.body.className;
  popupBody.style.margin = "0";
  popupBody.style.background = "var(--alt-bg-primary)";
  popupBody.style.color = "var(--alt-text-primary)";
}

const DECK_PAGE_TABS: Array<{ id: TelemetryDeckPageId; label: string }> = [
  { id: "flight", label: "Flight" },
  { id: "link", label: "Link" },
  { id: "power", label: "Power" },
  { id: "tuning", label: "Tuning" },
];

const CATEGORY_ORDER: DeckMetricCategory[] = [
  "Flight",
  "Navigation",
  "Power",
  "GPS",
  "Link",
  "Wind",
  "Tuning",
];

const DECK_METRIC_OPTIONS: DeckMetricOption[] = [
  { id: "relAlt", label: "REL ALT", category: "Flight" },
  { id: "airspeed", label: "AIRSPD", category: "Flight" },
  { id: "groundspeedMs", label: "GSPD", category: "Flight" },
  { id: "throttle", label: "THR", category: "Flight" },
  { id: "climbRate", label: "CLIMB", category: "Flight" },
  { id: "roll", label: "ROLL", category: "Flight" },
  { id: "pitch", label: "PITCH", category: "Flight" },
  { id: "yaw", label: "YAW", category: "Flight" },

  { id: "wpDistance", label: "WP DIST", category: "Navigation" },
  { id: "xtrackError", label: "XTRACK", category: "Navigation" },
  { id: "altError", label: "ALT ERR", category: "Navigation" },
  { id: "navBearing", label: "NAV BRG", category: "Navigation" },
  { id: "targetBearing", label: "TGT BRG", category: "Navigation" },

  { id: "batteryVoltage", label: "BAT V", category: "Power" },
  { id: "batteryCurrent", label: "BAT A", category: "Power" },
  { id: "batteryConsumed", label: "mAh", category: "Power" },
  { id: "powerWatts", label: "WATTS", category: "Power" },
  { id: "estFlightMin", label: "EST MIN", category: "Power" },

  { id: "gpsFix", label: "GPS FIX", category: "GPS" },
  { id: "satellites", label: "SATS", category: "GPS" },
  { id: "gpsHdop", label: "HDOP", category: "GPS" },

  { id: "radioRssi", label: "RSSI", category: "Link" },
  { id: "remrssi", label: "REM RSSI", category: "Link" },
  { id: "noise", label: "NOISE", category: "Link" },
  { id: "remnoise", label: "REM NOISE", category: "Link" },
  { id: "rxerrors", label: "RX ERR", category: "Link" },
  { id: "txbuf", label: "TX BUF", category: "Link" },

  { id: "windSpeed", label: "WIND", category: "Wind" },
  { id: "windDirection", label: "WIND DIR", category: "Wind" },

  { id: "ekfVelRatio", label: "EKF VEL", category: "Tuning" },
  { id: "ekfPosHorizRatio", label: "EKF POS", category: "Tuning" },
  { id: "vibeX", label: "VIBE X", category: "Tuning" },
  { id: "vibeY", label: "VIBE Y", category: "Tuning" },
  { id: "vibeZ", label: "VIBE Z", category: "Tuning" },
];

const DECK_PRESETS: Array<{ id: string; label: string; metrics: TelemetryDeckMetricId[] }> = [
  {
    id: "mapping",
    label: "Mapping",
    metrics: ["relAlt", "groundspeedMs", "airspeed", "throttle", "gpsFix", "satellites", "batteryVoltage", "powerWatts"],
  },
  {
    id: "cinematic",
    label: "Cinematic",
    metrics: ["groundspeedMs", "climbRate", "roll", "pitch", "yaw", "windSpeed", "batteryVoltage", "estFlightMin"],
  },
  {
    id: "long-range",
    label: "Long-range",
    metrics: ["radioRssi", "remrssi", "noise", "remnoise", "rxerrors", "txbuf", "batteryVoltage", "estFlightMin"],
  },
  {
    id: "tuning",
    label: "Tuning",
    metrics: ["roll", "pitch", "yaw", "vibeX", "vibeY", "vibeZ", "ekfVelRatio", "ekfPosHorizRatio"],
  },
];

const DECK_THRESHOLDS: Partial<Record<TelemetryDeckMetricId, DeckThreshold>> = {
  batteryVoltage: { mode: "lt", warning: 14.4, critical: 14.0 },
  batteryCurrent: { mode: "gt", warning: 45, critical: 60 },
  powerWatts: { mode: "gt", warning: 650, critical: 850 },
  estFlightMin: { mode: "lt", warning: 5, critical: 2.5 },
  satellites: { mode: "lt", warning: 10, critical: 6 },
  gpsHdop: { mode: "gt", warning: 2.2, critical: 4 },
  gpsFix: { mode: "lt", warning: 3, critical: 2 },
  radioRssi: { mode: "lt", warning: 35, critical: 20 },
  remrssi: { mode: "lt", warning: 35, critical: 20 },
  noise: { mode: "gt", warning: 30, critical: 45 },
  remnoise: { mode: "gt", warning: 30, critical: 45 },
  rxerrors: { mode: "gt", warning: 5, critical: 20 },
  txbuf: { mode: "lt", warning: 40, critical: 20 },
  roll: { mode: "absGt", warning: 35, critical: 55 },
  pitch: { mode: "absGt", warning: 35, critical: 55 },
  climbRate: { mode: "absGt", warning: 5, critical: 8 },
  xtrackError: { mode: "absGt", warning: 8, critical: 15 },
  altError: { mode: "absGt", warning: 5, critical: 10 },
  ekfVelRatio: { mode: "gt", warning: 0.8, critical: 1.0 },
  ekfPosHorizRatio: { mode: "gt", warning: 0.8, critical: 1.0 },
  vibeX: { mode: "gt", warning: 35, critical: 55 },
  vibeY: { mode: "gt", warning: 35, critical: 55 },
  vibeZ: { mode: "gt", warning: 35, critical: 55 },
};

function gpsFixLabel(fixType: number): string {
  if (fixType >= 3) return "3D";
  if (fixType === 2) return "2D";
  return "No Fix";
}

function gpsFixColor(fixType: number): string {
  if (fixType >= 3) return "text-status-success";
  if (fixType === 2) return "text-status-warning";
  return "text-status-error";
}

function batteryBarColor(pct: number): string {
  if (pct <= 25) return "bg-status-error";
  if (pct <= 50) return "bg-status-warning";
  return "bg-status-success";
}

function FlightCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center py-1.5">
      <span className="text-sm font-mono font-semibold tabular-nums text-text-primary">
        {value}
      </span>
      <span className="text-[10px] text-text-tertiary mt-0.5">{label}</span>
    </div>
  );
}

function estimateFlightMinutes(remainingPct: number, consumedMah: number, currentA: number): number {
  if (currentA <= 0.01 || remainingPct <= 0 || consumedMah <= 0 || remainingPct >= 99.9) return 0;
  const consumedFraction = 1 - (remainingPct / 100);
  if (consumedFraction <= 0) return 0;
  const estimatedTotalMah = consumedMah / consumedFraction;
  const remainingMah = Math.max(estimatedTotalMah - consumedMah, 0);
  return (remainingMah / (currentA * 1000)) * 60;
}

function getSeverity(metricId: TelemetryDeckMetricId, rawValue: number): DeckSeverity {
  const cfg = DECK_THRESHOLDS[metricId];
  if (!cfg || Number.isNaN(rawValue)) return "normal";

  const value = cfg.mode === "absGt" ? Math.abs(rawValue) : rawValue;

  if (cfg.mode === "lt") {
    if (value <= cfg.critical) return "critical";
    if (value <= cfg.warning) return "warning";
    return "normal";
  }

  if (value >= cfg.critical) return "critical";
  if (value >= cfg.warning) return "warning";
  return "normal";
}

function DeckCell({
  label,
  value,
  severity,
  dragging,
  dragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  label: string;
  value: string;
  severity: DeckSeverity;
  dragging: boolean;
  dragOver: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const severityClass =
    severity === "critical"
      ? "border-status-error bg-status-error/10"
      : severity === "warning"
        ? "border-status-warning bg-status-warning/10"
        : "border-border-default bg-bg-secondary";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        "flex flex-col px-2 py-1.5 border transition-colors select-none min-w-0",
        severityClass,
        dragging && "opacity-50",
        dragOver && "ring-1 ring-accent-primary/70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] text-text-tertiary uppercase tracking-wide truncate">{label}</span>
        <GripVertical size={10} className="text-text-tertiary/70 shrink-0" />
      </div>
      <span className="text-[11px] font-mono font-semibold tabular-nums text-text-primary leading-tight truncate max-w-full mt-0.5">
        {value}
      </span>
    </div>
  );
}

export function TelemetryReadout() {
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
  const themeMode = useSettingsStore((s) => s.themeMode);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const [deckOpen, setDeckOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [deckDetached, setDeckDetached] = useState(false);
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null);
  const [dragOverMetricId, setDragOverMetricId] = useState<TelemetryDeckMetricId | null>(null);
  const draggingMetricIdRef = useRef<TelemetryDeckMetricId | null>(null);
  const popupRef = useRef<Window | null>(null);
  const thresholdRef = useRef<Partial<Record<TelemetryDeckMetricId, DeckSeverity>>>({});
  const { toast } = useToast();

  const alt = pos?.alt ?? vfr?.alt ?? 0;
  const speedKph = mpsToKph(vfr?.groundspeed ?? pos?.groundSpeed ?? 0);
  const heading = normalizeHeading(pos?.heading ?? vfr?.heading ?? 0);
  const vs = vfr?.climb ?? pos?.climbRate ?? 0;
  const batteryPct = bat?.remaining ?? 0;
  const satellites = gps?.satellites ?? 0;
  const fixType = gps?.fixType ?? 0;
  const powerWatts = (bat?.voltage ?? 0) * (bat?.current ?? 0);
  const estimatedMinutes = estimateFlightMinutes(batteryPct, bat?.consumed ?? 0, bat?.current ?? 0);

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
      gpsFix: gpsFixLabel(fixType),
      satellites: `${satellites}`,
      gpsHdop: `${(gps?.hdop ?? 0).toFixed(1)}`,
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
      radioRssi: `${Math.round(radio?.rssi ?? 0)}`,
      remrssi: `${Math.round(radio?.remrssi ?? 0)}`,
      noise: `${Math.round(radio?.noise ?? 0)}`,
      remnoise: `${Math.round(radio?.remnoise ?? 0)}`,
      rxerrors: `${Math.round(radio?.rxerrors ?? 0)}`,
      txbuf: `${Math.round(radio?.txbuf ?? 0)}%`,
      powerWatts: `${powerWatts.toFixed(0)}W`,
      estFlightMin: `${estimatedMinutes.toFixed(1)}m`,
      ekfVelRatio: `${(ekf?.velocityVariance ?? 0).toFixed(2)}`,
      ekfPosHorizRatio: `${(ekf?.posHorizVariance ?? 0).toFixed(2)}`,
      vibeX: `${(vibration?.vibrationX ?? 0).toFixed(1)}`,
      vibeY: `${(vibration?.vibrationY ?? 0).toFixed(1)}`,
      vibeZ: `${(vibration?.vibrationZ ?? 0).toFixed(1)}`,
    }),
    [
      att,
      bat,
      ekf,
      estimatedMinutes,
      fixType,
      gps?.hdop,
      heading,
      nav,
      pos,
      powerWatts,
      radio,
      satellites,
      vfr,
      vibration,
      wind,
    ],
  );

  const metricRawValues = useMemo<Record<TelemetryDeckMetricId, number>>(
    () => ({
      relAlt: pos?.relativeAlt ?? 0,
      airspeed: vfr?.airspeed ?? pos?.airSpeed ?? 0,
      groundspeedMs: pos?.groundSpeed ?? vfr?.groundspeed ?? 0,
      throttle: vfr?.throttle ?? 0,
      climbRate: vfr?.climb ?? pos?.climbRate ?? 0,
      gpsFix: fixType,
      satellites,
      gpsHdop: gps?.hdop ?? 0,
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
      radioRssi: radio?.rssi ?? 0,
      remrssi: radio?.remrssi ?? 0,
      noise: radio?.noise ?? 0,
      remnoise: radio?.remnoise ?? 0,
      rxerrors: radio?.rxerrors ?? 0,
      txbuf: radio?.txbuf ?? 0,
      powerWatts,
      estFlightMin: estimatedMinutes,
      ekfVelRatio: ekf?.velocityVariance ?? 0,
      ekfPosHorizRatio: ekf?.posHorizVariance ?? 0,
      vibeX: vibration?.vibrationX ?? 0,
      vibeY: vibration?.vibrationY ?? 0,
      vibeZ: vibration?.vibrationZ ?? 0,
    }),
    [att, bat, ekf, estimatedMinutes, fixType, gps?.hdop, heading, nav, pos, powerWatts, radio, satellites, vfr, vibration, wind],
  );

  const metricLabelsById = useMemo(
    () =>
      Object.fromEntries(DECK_METRIC_OPTIONS.map((m) => [m.id, m.label])) as Record<
        TelemetryDeckMetricId,
        string
      >,
    [],
  );

  const activeDeckMetricIds = useMemo(
    () => activePageMetrics.filter((id) => Object.prototype.hasOwnProperty.call(deckMetricValues, id)),
    [activePageMetrics, deckMetricValues],
  );

  useEffect(() => {
    for (const metricId of activeDeckMetricIds) {
      const current = getSeverity(metricId, metricRawValues[metricId]);
      const previous = thresholdRef.current[metricId];
      if (previous !== undefined && previous !== current && current !== "normal") {
        const status = current === "critical" ? "error" : "warning";
        toast(`${metricLabelsById[metricId]} ${current}: ${deckMetricValues[metricId]}`, status);
      }
      thresholdRef.current[metricId] = current;
    }
  }, [activeDeckMetricIds, deckMetricValues, metricLabelsById, metricRawValues, toast]);

  const openDetachedDeck = useCallback(() => {
    const existing = popupRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      setDeckDetached(true);
      setDeckOpen(true);
      return;
    }

    const popup = window.open(
      "",
      "telemetry-deck-detached",
      "width=760,height=460,resizable=yes,scrollbars=no",
    );
    if (!popup) return;

    popup.document.title = "Telemetry Deck";
    popup.document.body.innerHTML = "";
    popup.document.body.style.overflow = "hidden";

    const styleNodes = Array.from(document.querySelectorAll("style, link[rel='stylesheet']"));
    for (const node of styleNodes) {
      popup.document.head.appendChild(node.cloneNode(true));
    }

    syncPopupTheme(popup);

    const container = popup.document.createElement("div");
    container.style.width = "100vw";
    container.style.height = "100vh";
    popup.document.body.appendChild(container);

    popup.addEventListener("beforeunload", () => {
      setDeckDetached(false);
      setPopupContainer(null);
      popupRef.current = null;
    });

    popupRef.current = popup;
    setPopupContainer(container);
    setDeckDetached(true);
    setDeckOpen(true);
    popup.focus();
  }, []);

  const closeDetachedDeck = useCallback(() => {
    setDeckDetached(false);
    setPopupContainer(null);
    const popup = popupRef.current;
    if (popup && !popup.closed) popup.close();
    popupRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      const popup = popupRef.current;
      if (popup && !popup.closed) popup.close();
      popupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup || popup.closed) return;
    syncPopupTheme(popup);
  }, [themeMode, accentColor]);

  const handleToggleMetric = (metric: TelemetryDeckMetricId) => {
    toggleTelemetryDeckPageMetric(telemetryDeckActivePage, metric);
  };

  const handleSelectPreset = (metrics: TelemetryDeckMetricId[]) => {
    setTelemetryDeckPageMetrics(telemetryDeckActivePage, metrics);
  };

  const handleCategorySelection = (category: DeckMetricCategory, mode: "all" | "none") => {
    const categoryIds = DECK_METRIC_OPTIONS.filter((m) => m.category === category).map((m) => m.id);
    if (mode === "all") {
      const next = [...activeDeckMetricIds, ...categoryIds.filter((id) => !activeDeckMetricIds.includes(id))];
      setTelemetryDeckPageMetrics(telemetryDeckActivePage, next);
      return;
    }

    const next = activeDeckMetricIds.filter((id) => !categoryIds.includes(id));
    if (next.length === 0) {
      const fallback = DEFAULT_TELEMETRY_DECK_PAGES[telemetryDeckActivePage][0];
      setTelemetryDeckPageMetrics(telemetryDeckActivePage, [fallback]);
      return;
    }
    setTelemetryDeckPageMetrics(telemetryDeckActivePage, next);
  };

  const filteredMetricOptions = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    if (!query) return DECK_METRIC_OPTIONS;
    return DECK_METRIC_OPTIONS.filter((metric) => {
      return (
        metric.label.toLowerCase().includes(query) ||
        metric.id.toLowerCase().includes(query) ||
        metric.category.toLowerCase().includes(query)
      );
    });
  }, [pickerQuery]);

  const metricsByCategory = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      metrics: filteredMetricOptions.filter((m) => m.category === category),
    })).filter((g) => g.metrics.length > 0);
  }, [filteredMetricOptions]);

  const uniquePageTabs = useMemo(() => {
    const seen = new Set<TelemetryDeckPageId>();
    return DECK_PAGE_TABS.filter((page) => {
      if (seen.has(page.id)) return false;
      seen.add(page.id);
      return true;
    });
  }, []);

  const uniquePresetTabs = useMemo(() => {
    const seen = new Set<string>();
    return DECK_PRESETS.filter((preset) => {
      const key = preset.id.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, []);

  const renderDeckPanel = (detached: boolean) => (
    <div className={cn("space-y-2", detached && "h-full flex flex-col")}>
      <div className="space-y-2 min-w-0">
        <div className="space-y-1">
          <p className="text-[9px] font-mono uppercase tracking-wide text-text-tertiary">Pages</p>
          <div className="flex flex-wrap gap-1.5">
            {uniquePageTabs.map((page) => (
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

        <div className="space-y-1">
          <p className="text-[9px] font-mono uppercase tracking-wide text-text-tertiary">Presets</p>
          <div className="flex flex-wrap items-center gap-1">
            {uniquePresetTabs.map((preset) => {
              const selected =
                preset.metrics.length === activeDeckMetricIds.length &&
                preset.metrics.every((metric, index) => metric === activeDeckMetricIds[index]);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.metrics)}
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

      <div className={cn(detached && "flex-1 min-h-0 overflow-auto pr-1")}> 
        <div className="grid grid-cols-4 gap-1.5">
          {activeDeckMetricIds.map((metricId) => {
            const label = metricLabelsById[metricId] ?? metricId;
            const severity = getSeverity(metricId, metricRawValues[metricId]);
            return (
              <DeckCell
                key={metricId}
                label={label}
                value={deckMetricValues[metricId]}
                severity={severity}
                dragging={draggingMetricIdRef.current === metricId}
                dragOver={dragOverMetricId === metricId}
                onDragStart={() => {
                  draggingMetricIdRef.current = metricId;
                }}
                onDragEnd={() => {
                  draggingMetricIdRef.current = null;
                  setDragOverMetricId(null);
                }}
                onDragOver={() => {
                  setDragOverMetricId(metricId);
                }}
                onDrop={() => {
                  const dragged = draggingMetricIdRef.current;
                  if (!dragged || dragged === metricId) return;
                  const fromIndex = activeDeckMetricIds.indexOf(dragged);
                  const toIndex = activeDeckMetricIds.indexOf(metricId);
                  moveTelemetryDeckMetric(telemetryDeckActivePage, fromIndex, toIndex);
                  draggingMetricIdRef.current = null;
                  setDragOverMetricId(null);
                }}
              />
            );
          })}
        </div>
      </div>

      {customizeOpen && (
        <div className="border border-border-default bg-bg-secondary px-2 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search metrics..."
              className="flex-1 h-7 px-2 text-[10px] font-mono bg-bg-tertiary border border-border-default"
            />
          </div>

          <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
            {metricsByCategory.map(({ category, metrics }) => (
              <div key={category} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-tertiary uppercase tracking-wide">{category}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCategorySelection(category, "all")}
                      className="px-1.5 py-0.5 text-[9px] rounded border border-border-default text-text-tertiary hover:text-text-secondary"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCategorySelection(category, "none")}
                      className="px-1.5 py-0.5 text-[9px] rounded border border-border-default text-text-tertiary hover:text-text-secondary"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {metrics.map((metric) => {
                    const selected = activeDeckMetricIds.includes(metric.id);
                    return (
                      <button
                        key={metric.id}
                        type="button"
                        onClick={() => handleToggleMetric(metric.id)}
                        className={cn(
                          "px-2 py-1 text-[10px] rounded border font-mono transition-colors",
                          selected
                            ? "border-accent-primary/60 bg-accent-primary/15 text-text-primary"
                            : "border-border-default bg-bg-tertiary text-text-tertiary hover:text-text-secondary",
                        )}
                      >
                        {selected ? "✓ " : ""}
                        {metric.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-text-tertiary">Drag tiles in the deck to reorder. At least one metric stays enabled.</p>
        </div>
      )}
    </div>
  );

  const handleToggleCustomize = () => {
    setCustomizeOpen((prev) => {
      const next = !prev;
      if (next) setDeckOpen(true);
      return next;
    });
  };

  return (
    <div className="bg-bg-secondary border-y border-border-default">
      {/* Primary flight metrics — 4 columns */}
      <div className="grid grid-cols-4 divide-x divide-border-default">
        <FlightCell label="ALT" value={`${alt.toFixed(1)}m`} />
        <FlightCell label="SPD" value={`${speedKph.toFixed(1)}`} />
        <FlightCell label="HDG" value={`${String(Math.round(heading)).padStart(3, "0")}\u00B0`} />
        <FlightCell label="VS" value={`${vs.toFixed(1)}`} />
      </div>

      {/* Status bar — GPS, battery, mode */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border-default text-[10px] font-mono">
        {/* GPS */}
        <div className="flex items-center gap-1">
          <span className={cn("inline-block w-1.5 h-1.5 rounded-full", fixType >= 3 ? "bg-status-success" : fixType === 2 ? "bg-status-warning" : "bg-status-error")} />
          <span className={cn("tabular-nums", gpsFixColor(fixType))}>{satellites}</span>
          <span className="text-text-tertiary">SAT</span>
        </div>

        {/* Battery bar inline */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", batteryBarColor(batteryPct))}
              style={{ width: `${Math.max(batteryPct, 2)}%` }}
            />
          </div>
          <span className={cn("tabular-nums", batteryPct <= 25 ? "text-status-error" : batteryPct <= 50 ? "text-status-warning" : "text-text-secondary")}>
            {Math.round(batteryPct)}%
          </span>
        </div>

        {/* Flight mode with description tooltip */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ModeLabel mode={mode} />
          <button
            type="button"
            onClick={handleToggleCustomize}
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
            onClick={() => setDeckOpen((v) => !v)}
            className="p-1 rounded border border-border-default text-text-tertiary hover:text-text-primary transition-colors"
            title={deckOpen ? "Collapse expanded telemetry deck" : "Expand telemetry deck"}
            aria-label={deckOpen ? "Collapse expanded telemetry deck" : "Expand telemetry deck"}
          >
            <ChevronDown size={11} className={cn("transition-transform duration-200", deckOpen && "rotate-180")} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (deckDetached) {
                closeDetachedDeck();
                return;
              }
              openDetachedDeck();
            }}
            className={cn(
              "px-1.5 py-1 rounded border border-border-default text-[10px] font-mono text-text-tertiary hover:text-text-primary transition-colors",
              deckDetached && "text-accent-primary border-accent-primary/50",
            )}
            title={deckDetached ? "Reattach detached telemetry deck" : "Detach telemetry deck"}
            aria-label={deckDetached ? "Reattach detached telemetry deck" : "Detach telemetry deck"}
          >
            {deckDetached ? "ATTACH" : "DETACH"}
          </button>
        </div>
      </div>

      {/* Expandable telemetry deck */}
      <div
        className={cn(
          "transition-all duration-300 ease-out border-t border-border-default bg-bg-primary/30",
          deckOpen ? "max-h-80 opacity-100 overflow-y-auto" : "max-h-0 opacity-0 overflow-hidden",
        )}
      >
        <div className="px-2 py-2 space-y-2">
          {!deckDetached && renderDeckPanel(false)}

          {deckDetached && (
            <div className="px-2 py-3 border border-border-default bg-bg-secondary text-[10px] text-text-tertiary">
              Telemetry deck is detached to a separate window.
            </div>
          )}
        </div>
      </div>

      {deckDetached && popupContainer && createPortal(
        <div className="w-full h-full bg-bg-primary p-2">
          <div className="w-full h-full border border-border-default bg-bg-secondary p-2 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border-default pb-1.5 mb-2">
              <span className="text-[11px] font-mono text-text-secondary">Telemetry Deck</span>
              <button
                type="button"
                onClick={closeDetachedDeck}
                className="px-2 py-1 text-[10px] rounded border border-border-default text-text-tertiary hover:text-text-primary"
              >
                Reattach
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {renderDeckPanel(true)}
            </div>
          </div>
        </div>,
        popupContainer,
      )}
    </div>
  );
}

function ModeLabel({ mode }: { mode: string }) {
  const [show, setShow] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const prevModeRef = useRef(mode);
  const { toast } = useToast();
  const desc = MODE_DESCRIPTIONS[mode as UnifiedFlightMode];

  useEffect(() => {
    if (prevModeRef.current !== mode && prevModeRef.current !== "") {
      setHighlight(true);
      toast(`Mode changed: ${prevModeRef.current} -> ${mode}`, "info");
      const timer = setTimeout(() => setHighlight(false), 1500);
      prevModeRef.current = mode;
      return () => clearTimeout(timer);
    }
    prevModeRef.current = mode;
  }, [mode, toast]);

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        className={cn(
          "font-semibold uppercase cursor-default transition-colors duration-300",
          highlight ? "text-status-success" : "text-text-secondary",
        )}
        style={highlight ? {
          animation: "mode-pulse 1.5s ease-out",
          textShadow: "0 0 8px rgba(34, 197, 94, 0.6)",
        } : undefined}
      >
        {mode}
      </span>
      {show && desc && (
        <div className="absolute right-0 bottom-full mb-1 z-50 bg-bg-tertiary border border-border-default px-2 py-1.5 text-[10px] text-text-secondary whitespace-nowrap">
          {desc}
        </div>
      )}
    </div>
  );
}
