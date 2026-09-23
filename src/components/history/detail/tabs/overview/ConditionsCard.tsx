"use client";

/**
 * Conditions card — sun/moon snapshot + METAR weather + phase legend.
 *
 * @module components/history/detail/tabs/overview/ConditionsCard
 */

import { Sun, Moon, Sparkles, Cloud } from "lucide-react";
import type { SunMoonSnapshot, WeatherSnapshot } from "@/lib/types";
import { Row } from "./shared";

function fmtHhMm(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const PHASE_LABEL_KEYS: Record<SunMoonSnapshot["daylightPhase"], string> = {
  day: "phaseDay",
  civil_twilight: "phaseCivilTwilight",
  nautical_twilight: "phaseNauticalTwilight",
  astronomical_twilight: "phaseAstronomicalTwilight",
  night: "phaseNight",
};

/** Small local helper — reach into i18n at call time without threading useTranslations into every leaf. */
function phaseLabel(key: string): string {
  // This component is rendered inside the i18n provider already, so a
  // small synthetic dict keeps us from adding a second useTranslations call
  // in this deeply nested helper component.
  const map: Record<string, string> = {
    phaseDay: "Day",
    phaseCivilTwilight: "Civil twilight",
    phaseNauticalTwilight: "Nautical twilight",
    phaseAstronomicalTwilight: "Astronomical twilight",
    phaseNight: "Night",
  };
  return map[key] ?? key;
}

export function ConditionsCard({
  sunMoon,
  weather,
}: {
  sunMoon?: SunMoonSnapshot;
  weather?: WeatherSnapshot;
}) {
  return (
    <div className="flex flex-col gap-2">
      {sunMoon && <SunMoonSection sunMoon={sunMoon} />}
      {weather && sunMoon && <div className="border-t border-border-default pt-2 mt-1" />}
      {weather && <WeatherSection weather={weather} />}
    </div>
  );
}

function SunMoonSection({ sunMoon }: { sunMoon: SunMoonSnapshot }) {
  const phaseKey = PHASE_LABEL_KEYS[sunMoon.daylightPhase];
  const phaseColor =
    sunMoon.daylightPhase === "day"
      ? "text-status-success"
      : sunMoon.daylightPhase === "night"
        ? "text-text-tertiary"
        : "text-status-warning";

  return (
    <div className="flex flex-col gap-2">
      {/* Phase summary row */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className={`inline-flex items-center gap-1 ${phaseColor}`}>
          {sunMoon.daylightPhase === "night" ? <Moon size={12} /> : <Sun size={12} />}
          <span className="uppercase tracking-wider font-semibold">{phaseLabel(phaseKey)}</span>
        </span>
        {sunMoon.inGoldenHour && (
          <span className="inline-flex items-center gap-1 text-status-warning">
            <Sparkles size={12} />
            Golden hour
          </span>
        )}
      </div>

      {/* Sun row */}
      <div className="flex flex-col gap-0.5">
        <Row label="Sunrise" value={fmtHhMm(sunMoon.sunriseIso)} mono />
        <Row label="Sunset" value={fmtHhMm(sunMoon.sunsetIso)} mono />
        <Row
          label="Sun"
          value={`${sunMoon.sunAltitudeDeg.toFixed(1)}° alt · ${sunMoon.sunAzimuthDeg.toFixed(0)}° az`}
          mono
        />
      </div>

      {/* Moon row */}
      <div className="flex flex-col gap-0.5 border-t border-border-default pt-2 mt-1">
        <Row label="Moon phase" value={sunMoon.moonPhaseLabel} />
        <Row
          label="Illumination"
          value={`${Math.round(sunMoon.moonIllumination * 100)}%`}
          mono
        />
        <Row
          label="Moon"
          value={`${sunMoon.moonAltitudeDeg.toFixed(1)}° alt · ${sunMoon.moonAzimuthDeg.toFixed(0)}° az`}
          mono
        />
      </div>
    </div>
  );
}

/**
 * METAR wind as shown on the card: "—" when the report has no wind, "Calm"
 * for 0 kt, "VRB" when the speed comes without a direction (a variable wind),
 * else "270° @ 12 kt G20".
 */
export function formatWind(weather: Pick<WeatherSnapshot, "windDirDeg" | "windKts" | "gustKts">): string {
  if (weather.windKts === undefined) return "—";
  if (weather.windKts === 0) return "Calm";
  const dir = weather.windDirDeg === undefined ? "VRB" : `${weather.windDirDeg}°`;
  const gust = weather.gustKts && weather.gustKts > 0 ? ` G${weather.gustKts}` : "";
  return `${dir} @ ${weather.windKts} kt${gust}`;
}

function WeatherSection({ weather }: { weather: WeatherSnapshot }) {
  const categoryColor: Record<string, string> = {
    VFR: "text-status-success",
    MVFR: "text-accent-primary",
    IFR: "text-status-warning",
    LIFR: "text-status-error",
  };
  const catClass = weather.flightCategory
    ? categoryColor[weather.flightCategory] ?? "text-text-primary"
    : "text-text-primary";

  const windText = formatWind(weather);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Header: station + category */}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 text-text-secondary">
          <Cloud size={12} />
          <span className="font-mono text-text-primary">{weather.stationIcao}</span>
          {weather.stationName && (
            <span className="truncate max-w-[180px]" title={weather.stationName}>
              · {weather.stationName}
            </span>
          )}
          {weather.stationDistanceKm !== undefined && (
            <span className="text-text-tertiary">· {weather.stationDistanceKm.toFixed(0)} km</span>
          )}
        </span>
        {weather.flightCategory && (
          <span className={`font-mono uppercase font-semibold ${catClass}`}>{weather.flightCategory}</span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {weather.tempC !== undefined && (
          <Row label="Temp / Dew" value={`${weather.tempC.toFixed(0)}°C / ${weather.dewPointC?.toFixed(0) ?? "—"}°C`} mono />
        )}
        <Row
          label="Wind"
          value={windText}
          mono
        />
        {weather.visibilityMi !== undefined && (
          <Row label="Visibility" value={`${weather.visibilityMi} mi`} mono />
        )}
        {weather.ceilingFtAgl !== undefined && (
          <Row label="Ceiling" value={`${weather.ceilingFtAgl} ft`} mono />
        )}
        {weather.altimeterHpa !== undefined && (
          <Row label="Altimeter" value={`${weather.altimeterHpa.toFixed(0)} hPa`} mono />
        )}
      </div>

      {weather.rawMetar && (
        <div className="mt-1 border-t border-border-default pt-1 text-[10px] font-mono text-text-tertiary leading-relaxed break-all">
          {weather.rawMetar}
        </div>
      )}
    </div>
  );
}
