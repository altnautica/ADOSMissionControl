/**
 * @module AircraftDetailPanel
 * @description Right-side detail panel for a selected aircraft showing identity,
 * position, dynamics, threat level, and follow/track controls.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { X, Crosshair, Route, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { useTrafficStore } from "@/stores/traffic-store";
import { cn } from "@/lib/utils";
import { THREAT_COLORS, THREAT_LABELS, type ThreatLevel } from "@/lib/airspace/types";
import { getTypeDescription, getCategoryDescription } from "@/lib/airspace/aircraft-types";

const EMERGENCY_SQUAWKS: Record<string, { label: string; color: string }> = {
  "7500": { label: "HIJACK", color: "#FF4444" },
  "7600": { label: "COMMS FAIL", color: "#FF4444" },
  "7700": { label: "EMERGENCY", color: "#FF4444" },
};

function countryFlag(country: string): string {
  const FLAGS: Record<string, string> = {
    "United States": "\u{1F1FA}\u{1F1F8}",
    "India": "\u{1F1EE}\u{1F1F3}",
    "United Kingdom": "\u{1F1EC}\u{1F1E7}",
    "Singapore": "\u{1F1F8}\u{1F1EC}",
    "Australia": "\u{1F1E6}\u{1F1FA}",
    "Germany": "\u{1F1E9}\u{1F1EA}",
    "Japan": "\u{1F1EF}\u{1F1F5}",
    "France": "\u{1F1EB}\u{1F1F7}",
    "Netherlands": "\u{1F1F3}\u{1F1F1}",
    "Sweden": "\u{1F1F8}\u{1F1EA}",
    "United Arab Emirates": "\u{1F1E6}\u{1F1EA}",
    "Qatar": "\u{1F1F6}\u{1F1E6}",
    "Saudi Arabia": "\u{1F1F8}\u{1F1E6}",
    "Indonesia": "\u{1F1EE}\u{1F1E9}",
    "China": "\u{1F1E8}\u{1F1F3}",
    "South Korea": "\u{1F1F0}\u{1F1F7}",
    "Hong Kong": "\u{1F1ED}\u{1F1F0}",
    "Brazil": "\u{1F1E7}\u{1F1F7}",
    "South Africa": "\u{1F1FF}\u{1F1E6}",
    "Ethiopia": "\u{1F1EA}\u{1F1F9}",
    "New Zealand": "\u{1F1F3}\u{1F1FF}",
    "Canada": "\u{1F1E8}\u{1F1E6}",
  };
  return FLAGS[country] ?? "";
}

export function AircraftDetailPanel() {
  const t = useTranslations("airTraffic");
  const selectedAircraft = useTrafficStore((s) => s.selectedAircraft);
  const aircraft = useTrafficStore((s) => s.aircraft);
  const threatLevels = useTrafficStore((s) => s.threatLevels);
  const followAircraft = useTrafficStore((s) => s.followAircraft);
  const trackedAircraft = useTrafficStore((s) => s.trackedAircraft);
  const setSelectedAircraft = useTrafficStore((s) => s.setSelectedAircraft);
  const setFollowAircraft = useTrafficStore((s) => s.setFollowAircraft);
  const toggleTracked = useTrafficStore((s) => s.toggleTracked);

  const ac = useMemo(() => {
    if (!selectedAircraft) return null;
    return aircraft.get(selectedAircraft) ?? null;
  }, [selectedAircraft, aircraft]);

  if (!ac) return null;

  const threat: ThreatLevel = threatLevels.get(ac.icao24) ?? "other";
  const threatColor = THREAT_COLORS[threat];
  const isFollowing = followAircraft === ac.icao24;
  const isTracked = trackedAircraft.has(ac.icao24);

  const altFt = ac.altitudeMsl != null ? Math.round(ac.altitudeMsl * 3.28084) : null;
  const flightLevel = altFt != null ? `FL${Math.round(altFt / 100).toString().padStart(3, "0")}` : null;
  const speedKts = ac.velocity != null ? Math.round(ac.velocity * 1.94384) : null;

  const squawkEmergency = ac.squawk ? EMERGENCY_SQUAWKS[ac.squawk] : null;

  const vrTrend = ac.verticalRate != null
    ? ac.verticalRate > 1 ? "climbing" : ac.verticalRate < -1 ? "descending" : "level"
    : "unknown";

  return (
    <div className="absolute top-4 right-14 z-10 w-64 bg-bg-primary/90 backdrop-blur-md border border-border-default rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: threatColor }} />
          <span className="text-sm font-mono font-bold text-text-primary truncate">
            {ac.callsign?.trim() || ac.icao24.toUpperCase()}
          </span>
        </div>
        <button
          onClick={() => setSelectedAircraft(null)}
          className="p-0.5 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-3 text-[10px] font-mono max-h-[70vh] overflow-y-auto">
        {/* Identity */}
        <Section title={t("identity")}>
          <Row label="ICAO24" value={ac.icao24.toUpperCase()} />
          {ac.registration && <Row label="Reg" value={ac.registration} />}
          {ac.aircraftType && (
            <Row label="Type" value={`${ac.aircraftType} - ${getTypeDescription(ac.aircraftType)}`} />
          )}
          <Row label="Category" value={getCategoryDescription(ac.category)} />
          <Row label="Country" value={`${countryFlag(ac.originCountry)} ${ac.originCountry}`} />
        </Section>

        {/* Position */}
        <Section title={t("position")}>
          <Row label="Lat" value={ac.lat.toFixed(6)} />
          <Row label="Lon" value={ac.lon.toFixed(6)} />
          {ac.altitudeMsl != null && (
            <Row label="Alt" value={`${Math.round(ac.altitudeMsl)}m (${altFt}ft)`} />
          )}
          {flightLevel && <Row label="FL" value={flightLevel} />}
          {ac.heading != null && (
            <Row label="Heading" value={
              <span className="flex items-center gap-1">
                {Math.round(ac.heading)}°
                <span className="inline-block text-[8px]" style={{ transform: `rotate(${ac.heading}deg)` }}>
                  {"\u2191"}
                </span>
              </span>
            } />
          )}
          {ac.velocity != null && (
            <Row label="Speed" value={`${Math.round(ac.velocity)} m/s (${speedKts} kts)`} />
          )}
        </Section>

        {/* Dynamics */}
        <Section title={t("dynamics")}>
          {ac.verticalRate != null && (
            <Row label="V/Rate" value={
              <span className={cn("flex items-center gap-1",
                vrTrend === "climbing" && "text-green-400",
                vrTrend === "descending" && "text-red-400",
              )}>
                {vrTrend === "climbing" && <ArrowUp size={9} />}
                {vrTrend === "descending" && <ArrowDown size={9} />}
                {vrTrend === "level" && <Minus size={9} />}
                {ac.verticalRate.toFixed(1)} m/s
              </span>
            } />
          )}
          {ac.heading != null && <Row label="Track" value={`${Math.round(ac.heading)}°`} />}
          <Row label="Squawk" value={
            squawkEmergency ? (
              <span className="font-bold" style={{ color: squawkEmergency.color }}>
                {ac.squawk} {squawkEmergency.label}
              </span>
            ) : (ac.squawk ?? "N/A")
          } />
        </Section>

        {/* Threat */}
        <Section title={t("threat")}>
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
              style={{ backgroundColor: threatColor + "22", color: threatColor }}
            >
              {THREAT_LABELS[threat]}
            </span>
          </div>
        </Section>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setFollowAircraft(isFollowing ? null : ac.icao24)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border transition-colors cursor-pointer text-[10px]",
              isFollowing
                ? "bg-accent-primary/20 border-accent-primary/50 text-accent-primary"
                : "border-border-default hover:bg-bg-secondary text-text-secondary"
            )}
          >
            <Crosshair size={10} />
            {isFollowing ? t("following") : t("follow")}
          </button>
          <button
            onClick={() => toggleTracked(ac.icao24)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded border transition-colors cursor-pointer text-[10px]",
              isTracked
                ? "bg-accent-primary/20 border-accent-primary/50 text-accent-primary"
                : "border-border-default hover:bg-bg-secondary text-text-secondary"
            )}
          >
            <Route size={10} />
            {isTracked ? t("tracking") : t("track")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold text-text-tertiary uppercase tracking-wider">{title}</span>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-text-tertiary shrink-0">{label}</span>
      <span className="text-text-primary text-right">{value}</span>
    </div>
  );
}
