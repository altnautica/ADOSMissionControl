"use client";

/**
 * Overview tab — Flight Info + Metrics cards.
 *
 * @license GPL-3.0-only
 */

import { Card } from "@/components/ui/card";
import { DataValue } from "@/components/ui/data-value";
import { formatDate, formatDuration, formatTime } from "@/lib/utils";
import { computeSuiteKpis } from "@/lib/kpi/suite-kpis";
import { summarizeFlight, suggestTags } from "@/lib/ai/flight-summarizer";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import { useHistoryStore } from "@/stores/history-store";
import { CheckCircle2, XCircle, AlertTriangle, Sun, Moon, Sparkles, Cloud, Shield, Activity, MapPin, Hexagon, Wind, Wand2, Tag } from "lucide-react";
import type {
  FlightRecord,
  FlightPhase,
  PreflightSnapshot,
  SunMoonSnapshot,
  WeatherSnapshot,
  AirspaceSnapshot,
  MissionAdherence,
  GeofenceBreach,
  WindEstimate,
} from "@/lib/types";

interface OverviewTabProps {
  record: FlightRecord;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function OverviewTab({ record }: OverviewTabProps) {
  const start = record.startTime ?? record.date;
  const batteries = useBatteryRegistryStore((s) => s.packs);
  const equipment = useEquipmentRegistryStore((s) => s.items);
  return (
    <div className="flex flex-col gap-3">
      <Card title="Flight Info" padding={true}>
        <div className="flex flex-col gap-2">
          <Row label="Drone" value={record.droneName} />
          {record.customName && <Row label="Name" value={record.customName} />}
          <Row label="Date" value={formatDate(start)} />
          <Row label="Start" value={formatTime(start)} />
          {record.endTime !== start && <Row label="End" value={formatTime(record.endTime)} />}
          {record.suiteType && <Row label="Suite" value={record.suiteType.toUpperCase()} />}
          {record.takeoffPlaceName && <Row label="Place" value={record.takeoffPlaceName} />}
          <Row label="Takeoff" value={fmtCoord(record.takeoffLat, record.takeoffLon)} mono />
          <Row label="Landing" value={fmtCoord(record.landingLat, record.landingLon)} mono />
          {record.landingPlaceName && (
            <Row label="Landing place" value={record.landingPlaceName} />
          )}
        </div>
      </Card>

      <Card title="Metrics" padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <DataValue label="Duration" value={formatDuration(record.duration)} />
          <DataValue label="Distance" value={(record.distance / 1000).toFixed(2)} unit="km" />
          <DataValue label="Max Altitude" value={record.maxAlt} unit="m" />
          <DataValue label="Max Speed" value={record.maxSpeed} unit="m/s" />
          {record.avgSpeed !== undefined && (
            <DataValue label="Avg Speed" value={record.avgSpeed} unit="m/s" />
          )}
          <DataValue label="Waypoints" value={record.waypointCount} />
          <DataValue label="Battery Used" value={record.batteryUsed} unit="%" />
          {record.batteryStartV !== undefined && (
            <DataValue label="Batt Start" value={record.batteryStartV.toFixed(2)} unit="V" />
          )}
          {record.batteryEndV !== undefined && (
            <DataValue label="Batt End" value={record.batteryEndV.toFixed(2)} unit="V" />
          )}
        </div>
      </Card>

      {/* Phase 22 — AI summary + suggested tags */}
      <SummaryCard record={record} />

      {record.adherence && (
        <Card title="Mission Adherence" padding={true}>
          <AdherenceCard
            adherence={record.adherence}
            missionName={record.missionName}
          />
        </Card>
      )}

      {record.geofenceBreaches && record.geofenceBreaches.length > 0 && (
        <Card title="Geofence" padding={true}>
          <GeofenceCard breaches={record.geofenceBreaches} />
        </Card>
      )}

      {record.phases && record.phases.length > 0 && (
        <Card title="Phases" padding={true}>
          <PhasesCard phases={record.phases} />
        </Card>
      )}

      {(record.sunMoon || record.weatherSnapshot || record.windEstimate) && (
        <Card title="Conditions" padding={true}>
          <ConditionsCard sunMoon={record.sunMoon} weather={record.weatherSnapshot} />
          {record.windEstimate && <WindCard wind={record.windEstimate} hasMetar={!!record.weatherSnapshot} />}
        </Card>
      )}

      {record.airspaceSnapshot && (
        <Card title="Airspace" padding={true}>
          <AirspaceCard snapshot={record.airspaceSnapshot} />
        </Card>
      )}

      {record.preflight && (
        <Card title="Pre-flight" padding={true}>
          <PreflightCard preflight={record.preflight} />
        </Card>
      )}

      {record.loadout && (
        <Card title="Loadout" padding={true}>
          <div className="flex flex-col gap-2">
            {(record.loadout.batteryIds ?? []).length > 0 && (
              <Row
                label="Batteries"
                value={(record.loadout.batteryIds ?? [])
                  .map((id) => batteries[id]?.label ?? id)
                  .join(", ")}
              />
            )}
            {record.loadout.propSetId && (
              <Row label="Prop set" value={equipment[record.loadout.propSetId]?.label ?? record.loadout.propSetId} />
            )}
            {record.loadout.motorSetId && (
              <Row label="Motor set" value={equipment[record.loadout.motorSetId]?.label ?? record.loadout.motorSetId} />
            )}
            {record.loadout.escSetId && (
              <Row label="ESC set" value={equipment[record.loadout.escSetId]?.label ?? record.loadout.escSetId} />
            )}
            {record.loadout.cameraId && (
              <Row label="Camera" value={equipment[record.loadout.cameraId]?.label ?? record.loadout.cameraId} />
            )}
            {record.loadout.gimbalId && (
              <Row label="Gimbal" value={equipment[record.loadout.gimbalId]?.label ?? record.loadout.gimbalId} />
            )}
            {record.loadout.payloadId && (
              <Row label="Payload" value={equipment[record.loadout.payloadId]?.label ?? record.loadout.payloadId} />
            )}
            {record.loadout.frameId && (
              <Row label="Frame" value={equipment[record.loadout.frameId]?.label ?? record.loadout.frameId} />
            )}
            {record.loadout.rcTxId && (
              <Row label="RC TX" value={equipment[record.loadout.rcTxId]?.label ?? record.loadout.rcTxId} />
            )}
          </div>
        </Card>
      )}

      {record.suiteType && (() => {
        const kpis = computeSuiteKpis(record);
        if (kpis.length === 0) return null;
        return (
          <Card title={`${record.suiteType.charAt(0).toUpperCase()}${record.suiteType.slice(1)} KPIs`} padding={true}>
            <div className="grid grid-cols-2 gap-3">
              {kpis.map((k) => (
                <DataValue key={k.label} label={k.label} value={k.value} unit={k.unit} />
              ))}
            </div>
          </Card>
        );
      })()}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-secondary">{label}</span>
      <span className={`text-xs text-text-primary ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function SummaryCard({ record }: { record: FlightRecord }) {
  const summary = summarizeFlight(record);
  const suggested = suggestTags(record);
  const existingTags = record.tags ?? [];
  const newTags = suggested.filter((t) => !existingTags.includes(t));

  const addTag = (tag: string) => {
    const store = useHistoryStore.getState();
    const current = store.records.find((r) => r.id === record.id)?.tags ?? [];
    if (current.includes(tag)) return;
    store.updateRecord(record.id, { tags: [...current, tag] });
    void store.persistToIDB();
  };

  return (
    <Card title="Summary" padding={true}>
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-1.5">
          <Wand2 size={11} className="text-accent-primary shrink-0 mt-0.5" />
          <p className="text-[11px] text-text-primary leading-relaxed">{summary}</p>
        </div>
        {newTags.length > 0 && (
          <div className="flex flex-col gap-1 mt-1 border-t border-border-default pt-2">
            <div className="flex items-center gap-1 text-[10px] text-text-secondary">
              <Tag size={10} />
              Suggested tags
            </div>
            <div className="flex flex-wrap gap-1">
              {newTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => addTag(tag)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary hover:bg-accent-primary/20 hover:text-accent-primary transition-colors"
                >
                  + {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

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

function ConditionsCard({
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

  const windText =
    weather.windKts === 0 || weather.windKts === undefined
      ? "Calm"
      : `${weather.windDirDeg ?? 0}° @ ${weather.windKts} kt${
          weather.gustKts && weather.gustKts > 0 ? ` G${weather.gustKts}` : ""
        }`;

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

const COMPASS_LABELS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

function compassLabel(deg: number): string {
  const idx = Math.round(deg / 22.5) % 16;
  return COMPASS_LABELS[idx];
}

function WindCard({ wind, hasMetar }: { wind: WindEstimate; hasMetar: boolean }) {
  return (
    <div className="flex flex-col gap-1 mt-2 border-t border-border-default pt-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
        <Wind size={11} className="text-accent-primary" />
        Wind (estimated from FC)
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <Row label="Speed" value={`${wind.speedMs.toFixed(1)} m/s`} mono />
        <Row label="From" value={`${wind.fromDirDeg}° (${compassLabel(wind.fromDirDeg)})`} mono />
        <Row label="Samples" value={wind.sampleCount.toString()} mono />
        <Row label="Method" value={wind.method === "vfr_diff" ? "GS − AS" : "Attitude track"} />
      </div>
      {hasMetar && (
        <span className="text-[9px] text-text-tertiary mt-0.5">
          METAR wind shown above is from the nearest station. This estimate is derived from the flight controller.
        </span>
      )}
    </div>
  );
}

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

const PHASE_LABELS: Record<FlightPhase["type"], string> = {
  pre_arm: "Pre-arm",
  takeoff: "Takeoff",
  climb: "Climb",
  cruise: "Cruise",
  hover: "Hover",
  descent: "Descent",
  land: "Land",
  post_disarm: "Post-disarm",
};

const PHASE_COLORS: Record<FlightPhase["type"], string> = {
  pre_arm: "#6b6b7f",
  takeoff: "#dff140",
  climb: "#3a82ff",
  cruise: "#22c55e",
  hover: "#a855f7",
  descent: "#f59e0b",
  land: "#ef4444",
  post_disarm: "#6b6b7f",
};

function fmtPhaseDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${s.toString().padStart(2, "0")}` : `${s}s`;
}

const BREACH_LABELS: Record<GeofenceBreach["type"], string> = {
  polygon_outside: "Outside polygon",
  polygon_inside: "Inside exclusion polygon",
  circle_outside: "Outside circle",
  circle_inside: "Inside exclusion circle",
  max_altitude: "Above max altitude",
  min_altitude: "Below min altitude",
};

function GeofenceCard({ breaches }: { breaches: GeofenceBreach[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] text-status-error">
        <AlertTriangle size={12} />
        <span className="uppercase tracking-wider font-semibold">
          {breaches.length} breach{breaches.length === 1 ? "" : "es"} detected
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {breaches.map((b, i) => (
          <li
            key={`${b.zoneId}-${b.type}-${i}`}
            className="flex flex-col gap-0.5 border-l-2 border-status-error pl-2 py-0.5"
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-text-primary">
                <Hexagon size={10} className="text-status-error" />
                {BREACH_LABELS[b.type]}
              </span>
              {b.maxBreachDistanceM !== undefined && b.maxBreachDistanceM > 0 && (
                <span className="font-mono text-status-error">
                  +{b.maxBreachDistanceM} m
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-text-tertiary font-mono">
              <span>zone: {b.zoneId}</span>
              <span>
                pts {b.startIdx}–{b.endIdx}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdherenceCard({
  adherence,
  missionName,
}: {
  adherence: MissionAdherence;
  missionName?: string;
}) {
  const reachedPct =
    adherence.totalWaypoints > 0
      ? Math.round((adherence.waypointsReached / adherence.totalWaypoints) * 100)
      : 0;

  // Severity colour based on max cross-track error.
  const errColour =
    adherence.maxCrossTrackErrorM > 50
      ? "text-status-error"
      : adherence.maxCrossTrackErrorM > 20
        ? "text-status-warning"
        : "text-status-success";

  return (
    <div className="flex flex-col gap-2">
      {missionName && (
        <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
          <MapPin size={12} />
          <span className="text-text-primary">{missionName}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Row
          label="Waypoints"
          value={`${adherence.waypointsReached}/${adherence.totalWaypoints} (${reachedPct}%)`}
        />
        <Row
          label="Max XTE"
          value={`${adherence.maxCrossTrackErrorM} m`}
        />
        <Row
          label="Mean XTE"
          value={`${adherence.meanCrossTrackErrorM} m`}
        />
        {adherence.deviationSegments && adherence.deviationSegments.length > 0 && (
          <Row
            label="Deviations"
            value={`${adherence.deviationSegments.length}`}
          />
        )}
      </div>
      {adherence.maxCrossTrackErrorM > 0 && (
        <div className={`text-[10px] font-mono ${errColour}`}>
          {adherence.maxCrossTrackErrorM > 50
            ? "Significant deviation from intended path"
            : adherence.maxCrossTrackErrorM > 20
              ? "Moderate deviation"
              : "Tracked the intended path closely"}
        </div>
      )}
    </div>
  );
}

function PhasesCard({ phases }: { phases: FlightPhase[] }) {
  const totalDurationMs = phases.reduce((acc, p) => acc + (p.endMs - p.startMs), 0) || 1;
  return (
    <div className="flex flex-col gap-2">
      {/* Stacked bar showing relative phase durations */}
      <div className="flex h-2 w-full overflow-hidden rounded">
        {phases.map((p, i) => {
          const w = ((p.endMs - p.startMs) / totalDurationMs) * 100;
          if (w < 0.5) return null;
          return (
            <div
              key={`bar-${i}`}
              style={{ width: `${w}%`, backgroundColor: PHASE_COLORS[p.type] }}
              title={`${PHASE_LABELS[p.type]} · ${fmtPhaseDuration(p.endMs - p.startMs)}`}
            />
          );
        })}
      </div>

      {/* Detailed list */}
      <ul className="flex flex-col gap-0.5">
        {phases.map((p, i) => (
          <li
            key={`row-${i}`}
            className="flex items-center justify-between gap-2 text-[11px]"
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: PHASE_COLORS[p.type] }}
              />
              <Activity size={10} className="text-text-tertiary" />
              <span className="text-text-primary">{PHASE_LABELS[p.type]}</span>
            </span>
            <span className="font-mono text-text-secondary">
              {fmtPhaseDuration(p.endMs - p.startMs)}
              {p.maxAlt !== undefined && (
                <span className="text-text-tertiary"> · {p.maxAlt}m</span>
              )}
              {p.avgSpeed !== undefined && p.avgSpeed > 0 && (
                <span className="text-text-tertiary"> · {p.avgSpeed}m/s</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AirspaceCard({ snapshot }: { snapshot: AirspaceSnapshot }) {
  const errorCount = snapshot.intersections.filter((i) => i.severity === "error").length;
  const warningCount = snapshot.intersections.filter((i) => i.severity === "warning").length;
  const infoCount = snapshot.intersections.filter((i) => i.severity === "info").length;

  return (
    <div className="flex flex-col gap-2">
      {/* Summary header */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1 text-text-secondary">
          <Shield size={12} />
          {snapshot.intersections.length} intersection{snapshot.intersections.length === 1 ? "" : "s"}
        </span>
        {errorCount > 0 && (
          <span className="text-status-error font-mono">{errorCount} restricted</span>
        )}
        {warningCount > 0 && (
          <span className="text-status-warning font-mono">{warningCount} advisory</span>
        )}
        {infoCount > 0 && (
          <span className="text-text-tertiary font-mono">{infoCount} controlled</span>
        )}
      </div>

      {/* Intersection list */}
      <ul className="flex flex-col gap-1.5">
        {snapshot.intersections.map((i) => (
          <li
            key={`${i.source}:${i.id}`}
            className="flex flex-col gap-0.5 border-l-2 pl-2 py-0.5"
            style={{
              borderColor:
                i.severity === "error"
                  ? "var(--color-status-error)"
                  : i.severity === "warning"
                    ? "var(--color-status-warning)"
                    : "var(--color-border-default)",
            }}
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span
                className={
                  i.severity === "error"
                    ? "text-status-error"
                    : i.severity === "warning"
                      ? "text-status-warning"
                      : "text-text-primary"
                }
              >
                {i.name}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-text-tertiary font-mono">
                {i.kind} · {i.source}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 text-[9px] text-text-tertiary font-mono">
              <span className="uppercase">{i.type}</span>
              {i.floorAltitude !== undefined && i.ceilingAltitude !== undefined && (
                <span>
                  {i.floorAltitude}–{i.ceilingAltitude}
                </span>
              )}
              {i.effectiveEndIso && (
                <span>until {new Date(i.effectiveEndIso).toLocaleDateString()}</span>
              )}
            </div>
            {i.summary && (
              <div className="text-[10px] text-text-tertiary leading-snug line-clamp-2">
                {i.summary}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreflightCard({ preflight }: { preflight: PreflightSnapshot }) {
  const items = preflight.checklistItems ?? [];
  const passed = items.filter((i) => i.status === "pass").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const failed = items.filter((i) => i.status === "fail").length;
  const pending = items.filter((i) => i.status === "pending").length;

  return (
    <div className="flex flex-col gap-2">
      {/* Summary */}
      <div className="flex items-center gap-3 text-[11px]">
        {preflight.checklistComplete ? (
          <span className="inline-flex items-center gap-1 text-status-success">
            <CheckCircle2 size={12} />
            Checklist complete
          </span>
        ) : items.length === 0 ? (
          <span className="text-text-tertiary">No checklist captured</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-status-warning">
            <AlertTriangle size={12} />
            Checklist incomplete
          </span>
        )}
        {items.length > 0 && (
          <span className="text-[10px] font-mono text-text-tertiary">
            {passed} pass · {skipped} skip · {failed} fail · {pending} pending
          </span>
        )}
      </div>

      {/* Failed items called out explicitly */}
      {failed > 0 && (
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((i) => i.status === "fail")
            .map((i) => (
              <li key={i.id} className="flex items-center gap-1.5 text-[10px] text-status-error">
                <XCircle size={10} />
                {i.label}
                {i.displayValue && <span className="text-text-tertiary font-mono">· {i.displayValue}</span>}
              </li>
            ))}
        </ul>
      )}

      {/* Prearm STATUSTEXT failures (ArduPilot only) */}
      {preflight.prearmFailures && preflight.prearmFailures.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary">FC prearm warnings</span>
          {preflight.prearmFailures.map((line, i) => (
            <span
              key={`${line}-${i}`}
              className="text-[10px] text-status-warning font-mono truncate"
              title={line}
            >
              {line}
            </span>
          ))}
        </div>
      )}

      {/* SYS_STATUS bitmasks */}
      {preflight.sysStatusHealth !== undefined && (
        <div className="flex flex-col gap-0.5 mt-1 text-[10px] font-mono text-text-tertiary">
          <span>Health: 0x{preflight.sysStatusHealth.toString(16).padStart(8, "0")}</span>
          {preflight.sysStatusEnabled !== undefined && (
            <span>Enabled: 0x{preflight.sysStatusEnabled.toString(16).padStart(8, "0")}</span>
          )}
          {preflight.sysStatusPresent !== undefined && (
            <span>Present: 0x{preflight.sysStatusPresent.toString(16).padStart(8, "0")}</span>
          )}
        </div>
      )}
    </div>
  );
}
