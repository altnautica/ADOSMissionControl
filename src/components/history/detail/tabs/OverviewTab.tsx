"use client";

/**
 * Overview tab — Flight Info + Metrics cards.
 *
 * @license GPL-3.0-only
 */

import { Card } from "@/components/ui/card";
import { DataValue } from "@/components/ui/data-value";
import { formatDate, formatDuration, formatTime } from "@/lib/utils";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import { CheckCircle2, XCircle, AlertTriangle, Sun, Moon, Sparkles, Cloud, Shield, Activity, MapPin } from "lucide-react";
import type {
  FlightRecord,
  FlightPhase,
  PreflightSnapshot,
  SunMoonSnapshot,
  WeatherSnapshot,
  AirspaceSnapshot,
  MissionAdherence,
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

      {record.adherence && (
        <Card title="Mission Adherence" padding={true}>
          <AdherenceCard
            adherence={record.adherence}
            missionName={record.missionName}
          />
        </Card>
      )}

      {record.phases && record.phases.length > 0 && (
        <Card title="Phases" padding={true}>
          <PhasesCard phases={record.phases} />
        </Card>
      )}

      {(record.sunMoon || record.weatherSnapshot) && (
        <Card title="Conditions" padding={true}>
          <ConditionsCard sunMoon={record.sunMoon} weather={record.weatherSnapshot} />
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
