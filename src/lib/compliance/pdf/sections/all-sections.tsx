/**
 * All PDF section renderers for the configurable template.
 *
 * Each section is a React-PDF component that renders a block of flight data.
 * Sections are selected by the user and composed by the configurable template.
 *
 * Phase 31b.
 *
 * @license GPL-3.0-only
 */

import { View, Text } from "@react-pdf/renderer";
import { styles } from "../styles";
import { Row } from "../_shared/Row";
import type { FlightRecord } from "@/lib/types";
import type { OperatorProfile, AircraftRecord } from "@/lib/types/operator";
import { computeSuiteKpis } from "@/lib/kpi/suite-kpis";

// ── Shared helpers ───────────────────────────────────────────

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ── Sections ─────────────────────────────────────────────────

interface SectionProps {
  record: FlightRecord;
  operator: OperatorProfile;
  aircraft?: AircraftRecord;
}

export function PilotOperatorSection({ operator }: SectionProps) {
  return (
    <View style={styles.section}>
      <SectionTitle>Pilot & Operator</SectionTitle>
      <View style={styles.twoCol}>
        <View style={styles.col}>
          <Row label="Pilot" value={[operator.pilotFirstName, operator.pilotLastName].filter(Boolean).join(" ") || "—"} />
          <Row label="License" value={operator.pilotLicenseNumber || "—"} />
          <Row label="Issuer" value={operator.pilotLicenseIssuer || "—"} />
          <Row label="Class" value={operator.pilotLicenseClass || "—"} />
          <Row label="Expiry" value={operator.pilotLicenseExpiry || "—"} />
        </View>
        <View style={styles.col}>
          <Row label="Operator" value={operator.operatorName || "—"} />
          <Row label="Cert #" value={operator.operatorCertNumber || "—"} />
          <Row label="Insurer" value={operator.insurerName || "—"} />
          <Row label="Policy" value={operator.insurancePolicyNumber || "—"} />
          <Row label="Ins. expiry" value={operator.insuranceExpiry || "—"} />
        </View>
      </View>
    </View>
  );
}

export function AircraftSection({ record, aircraft }: SectionProps) {
  return (
    <View style={styles.section}>
      <SectionTitle>Aircraft</SectionTitle>
      <View style={styles.twoCol}>
        <View style={styles.col}>
          <Row label="Name" value={record.droneName} />
          <Row label="Registration" value={record.aircraftRegistration ?? aircraft?.registrationNumber ?? "—"} />
          <Row label="Serial" value={record.aircraftSerial ?? aircraft?.serialNumber ?? "—"} />
          <Row label="Manufacturer" value={aircraft?.manufacturer ?? "—"} />
        </View>
        <View style={styles.col}>
          <Row label="Model" value={aircraft?.model ?? "—"} />
          <Row label="Type" value={aircraft?.vehicleType ?? "—"} />
          <Row label="Category" value={aircraft?.category ?? "—"} />
          <Row label="MTOM" value={record.aircraftMtomKg ? `${record.aircraftMtomKg} kg` : aircraft?.mtomKg ? `${aircraft.mtomKg} kg` : "—"} />
        </View>
      </View>
    </View>
  );
}

export function FlightCoreSection({ record }: SectionProps) {
  return (
    <View style={styles.section}>
      <SectionTitle>Flight</SectionTitle>
      <View style={styles.twoCol}>
        <View style={styles.col}>
          <Row label="ID" value={record.id.slice(0, 8)} />
          <Row label="Start" value={fmtDate(record.startTime ?? record.date)} />
          <Row label="End" value={fmtDate(record.endTime)} />
          <Row label="Duration" value={fmtDuration(record.duration)} />
          <Row label="Status" value={record.status} />
          {record.suiteType && <Row label="Suite" value={record.suiteType} />}
        </View>
        <View style={styles.col}>
          <Row label="Distance" value={`${(record.distance / 1000).toFixed(2)} km`} />
          <Row label="Max altitude" value={`${record.maxAlt.toFixed(0)} m AGL`} />
          <Row label="Max speed" value={`${record.maxSpeed.toFixed(1)} m/s`} />
          {record.avgSpeed !== undefined && <Row label="Avg speed" value={`${record.avgSpeed.toFixed(1)} m/s`} />}
          <Row label="Battery used" value={`${record.batteryUsed.toFixed(0)}%`} />
          {record.batteryStartV !== undefined && <Row label="Batt start" value={`${record.batteryStartV.toFixed(2)} V`} />}
          {record.batteryEndV !== undefined && <Row label="Batt end" value={`${record.batteryEndV.toFixed(2)} V`} />}
        </View>
      </View>
    </View>
  );
}

export function LocationSection({ record }: SectionProps) {
  return (
    <View style={styles.section}>
      <SectionTitle>Location</SectionTitle>
      <Row label="Takeoff" value={fmtCoord(record.takeoffLat, record.takeoffLon)} />
      {record.takeoffPlaceName && <Row label="Place" value={record.takeoffPlaceName} />}
      <Row label="Landing" value={fmtCoord(record.landingLat, record.landingLon)} />
      {record.landingPlaceName && <Row label="Landing place" value={record.landingPlaceName} />}
      {record.country && <Row label="Country" value={record.country} />}
      {record.region && <Row label="Region" value={record.region} />}
      {record.locality && <Row label="Locality" value={record.locality} />}
    </View>
  );
}

export function WeatherSection({ record }: SectionProps) {
  const w = record.weatherSnapshot;
  if (!w) return <View style={styles.section}><SectionTitle>Weather</SectionTitle><Row label="" value="No weather data captured." /></View>;
  return (
    <View style={styles.section}>
      <SectionTitle>Weather (METAR)</SectionTitle>
      <View style={styles.twoCol}>
        <View style={styles.col}>
          <Row label="Station" value={w.stationIcao ? `${w.stationIcao}${w.stationDistanceKm ? ` (${w.stationDistanceKm.toFixed(0)} km)` : ""}` : "—"} />
          <Row label="Temperature" value={w.tempC !== undefined ? `${w.tempC}°C` : "—"} />
          <Row label="Dew point" value={w.dewPointC !== undefined ? `${w.dewPointC}°C` : "—"} />
          <Row label="Altimeter" value={w.altimeterHpa !== undefined ? `${w.altimeterHpa} hPa` : "—"} />
        </View>
        <View style={styles.col}>
          <Row label="Wind" value={w.windKts !== undefined ? `${w.windDirDeg ?? "—"}° at ${w.windKts} kt${w.gustKts ? ` G${w.gustKts}` : ""}` : "Calm"} />
          <Row label="Visibility" value={w.visibilityMi !== undefined ? `${w.visibilityMi} SM` : "—"} />
          <Row label="Ceiling" value={w.ceilingFtAgl !== undefined ? `${w.ceilingFtAgl} ft AGL` : "—"} />
          <Row label="Flight cat." value={w.flightCategory ?? "—"} />
        </View>
      </View>
      {w.rawMetar && <Text style={{ fontSize: 7, color: "#6b6b7f", fontFamily: "Courier", marginTop: 4 }}>{w.rawMetar}</Text>}
    </View>
  );
}

export function SunMoonSection({ record }: SectionProps) {
  const s = record.sunMoon;
  if (!s) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>Sun & Moon</SectionTitle>
      <View style={styles.twoCol}>
        <View style={styles.col}>
          <Row label="Phase" value={s.daylightPhase.replace(/_/g, " ")} />
          <Row label="Sunrise" value={s.sunriseIso?.slice(11, 16) ?? "—"} />
          <Row label="Sunset" value={s.sunsetIso?.slice(11, 16) ?? "—"} />
          <Row label="Golden hour" value={s.inGoldenHour ? "Yes" : "No"} />
        </View>
        <View style={styles.col}>
          <Row label="Moon phase" value={s.moonPhaseLabel} />
          <Row label="Illumination" value={`${(s.moonIllumination * 100).toFixed(0)}%`} />
          <Row label="Sun altitude" value={`${s.sunAltitudeDeg.toFixed(1)}°`} />
        </View>
      </View>
    </View>
  );
}

export function WindSection({ record }: SectionProps) {
  const w = record.windEstimate;
  if (!w) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>Wind Estimate (FC-derived)</SectionTitle>
      <Row label="Speed" value={`${w.speedMs.toFixed(1)} m/s`} />
      <Row label="From" value={`${w.fromDirDeg}°`} />
      <Row label="Method" value={w.method === "vfr_diff" ? "Groundspeed − airspeed" : "Attitude track"} />
      <Row label="Samples" value={`${w.sampleCount}`} />
    </View>
  );
}

export function AirspaceSection({ record }: SectionProps) {
  const a = record.airspaceSnapshot;
  if (!a || a.intersections.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>{`Airspace (${a.intersections.length} intersections)`}</SectionTitle>
      {a.intersections.map((ix, i) => (
        <Row key={i} label={`${ix.severity.toUpperCase()} ${ix.kind}`} value={`${ix.name}${ix.floorAltitude !== undefined ? ` (${ix.floorAltitude}–${ix.ceilingAltitude ?? "∞"} ft)` : ""}`} />
      ))}
    </View>
  );
}

export function EventsSection({ record }: SectionProps) {
  const events = record.events;
  if (!events || events.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>{`Events Timeline (${events.length})`}</SectionTitle>
      {events.slice(0, 30).map((e, i) => {
        const mm = Math.floor(e.t / 60000);
        const ss = Math.floor((e.t % 60000) / 1000);
        return <Row key={i} label={`T+${mm}:${ss.toString().padStart(2, "0")} [${e.severity}]`} value={e.label} />;
      })}
      {events.length > 30 && <Text style={{ fontSize: 7, color: "#6b6b7f" }}>… and {events.length - 30} more events</Text>}
    </View>
  );
}

export function HealthSection({ record }: SectionProps) {
  const h = record.health;
  if (!h) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>Health Summary</SectionTitle>
      {h.avgSatellites !== undefined && <Row label="Avg satellites" value={String(h.avgSatellites.toFixed(1))} />}
      {h.avgHdop !== undefined && <Row label="Avg HDOP" value={String(h.avgHdop.toFixed(2))} />}
      {h.maxVibrationRms !== undefined && <Row label="Max vibration RMS" value={`${h.maxVibrationRms.toFixed(1)} m/s²`} />}
      {h.batteryHealthPct !== undefined && <Row label="Battery health" value={`${h.batteryHealthPct.toFixed(0)}%`} />}
    </View>
  );
}

export function PhasesSection({ record }: SectionProps) {
  const phases = record.phases;
  if (!phases || phases.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>Flight Phases</SectionTitle>
      {phases.map((p, i) => {
        const durSec = (p.endMs - p.startMs) / 1000;
        return <Row key={i} label={p.type.replace(/_/g, " ")} value={`${fmtDuration(durSec)}${p.avgSpeed !== undefined ? ` · ${p.avgSpeed.toFixed(1)} m/s avg` : ""}${p.maxAlt !== undefined ? ` · ${p.maxAlt.toFixed(0)} m max` : ""}`} />;
      })}
    </View>
  );
}

export function AdherenceSection({ record }: SectionProps) {
  const a = record.adherence;
  if (!a) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>Mission Adherence</SectionTitle>
      {record.missionName && <Row label="Mission" value={record.missionName} />}
      <Row label="Waypoints reached" value={`${String(a.waypointsReached)} / ${String(a.totalWaypoints)}`} />
      <Row label="Max cross-track error" value={`${a.maxCrossTrackErrorM.toFixed(1)} m`} />
      <Row label="Mean cross-track error" value={`${a.meanCrossTrackErrorM.toFixed(1)} m`} />
      {a.deviationSegments && a.deviationSegments.length > 0 && (
        <Row label="Deviation segments" value={`${a.deviationSegments.length}`} />
      )}
    </View>
  );
}

export function GeofenceSection({ record }: SectionProps) {
  const breaches = record.geofenceBreaches;
  if (!breaches || breaches.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>{`Geofence Breaches (${breaches.length})`}</SectionTitle>
      {breaches.map((b, i) => (
        <Row key={i} label={b.type.replace(/_/g, " ")} value={`Zone ${b.zoneId}${b.maxBreachDistanceM !== undefined ? ` · ${b.maxBreachDistanceM.toFixed(0)} m peak` : ""}`} />
      ))}
    </View>
  );
}

export function KpisSection({ record }: SectionProps) {
  if (!record.suiteType) return null;
  const kpis = computeSuiteKpis(record);
  if (kpis.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>{`${record.suiteType} KPIs`}</SectionTitle>
      {kpis.map((k, i) => (
        <Row key={i} label={k.label} value={`${k.value}${k.unit ? ` ${k.unit}` : ""}`} />
      ))}
    </View>
  );
}

export function PreflightSection({ record }: SectionProps) {
  const pf = record.preflight;
  if (!pf) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>Pre-flight Checklist</SectionTitle>
      <Row label="Complete" value={pf.checklistComplete ? "Yes" : "No"} />
      {pf.checklistItems?.map((item, i) => (
        <Row key={i} label={`${item.category} · ${item.label}`} value={`${item.status}${item.displayValue ? ` (${item.displayValue})` : ""}`} />
      ))}
      {pf.prearmFailures && pf.prearmFailures.length > 0 && (
        <>
          <Text style={{ fontSize: 8, fontWeight: 700, marginTop: 4, color: "#ef4444" }}>Prearm Failures</Text>
          {pf.prearmFailures.map((f, i) => (
            <Text key={i} style={{ fontSize: 7, fontFamily: "Courier", color: "#ef4444" }}>{f}</Text>
          ))}
        </>
      )}
    </View>
  );
}

export function LoadoutSection({ record }: SectionProps) {
  const lo = record.loadout;
  if (!lo) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>Loadout</SectionTitle>
      {lo.batteryIds && lo.batteryIds.length > 0 && <Row label="Batteries" value={lo.batteryIds.join(", ")} />}
      {lo.propSetId && <Row label="Prop set" value={lo.propSetId} />}
      {lo.motorSetId && <Row label="Motor set" value={lo.motorSetId} />}
      {lo.escSetId && <Row label="ESC set" value={lo.escSetId} />}
      {lo.cameraId && <Row label="Camera" value={lo.cameraId} />}
      {lo.gimbalId && <Row label="Gimbal" value={lo.gimbalId} />}
      {lo.payloadId && <Row label="Payload" value={lo.payloadId} />}
      {lo.frameId && <Row label="Frame" value={lo.frameId} />}
    </View>
  );
}

export function MediaSection({ record }: SectionProps) {
  const media = record.media;
  if (!media || media.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionTitle>{`Media (${media.length} files)`}</SectionTitle>
      {media.slice(0, 20).map((m, i) => (
        <Row key={i} label={new Date(m.capturedAt).toISOString().slice(0, 19)} value={`${m.name} (${m.type}, ${(m.size / 1024).toFixed(0)} KB)${m.lat !== undefined ? ` @ ${m.lat.toFixed(4)}, ${m.lon?.toFixed(4)}` : ""}`} />
      ))}
      {media.length > 20 && <Text style={{ fontSize: 7, color: "#6b6b7f" }}>… and {media.length - 20} more files</Text>}
    </View>
  );
}

export function NotesSection({ record }: SectionProps) {
  return (
    <View style={styles.section}>
      <SectionTitle>Notes & Tags</SectionTitle>
      {record.customName && <Row label="Name" value={record.customName} />}
      {record.tags && record.tags.length > 0 && <Row label="Tags" value={record.tags.join(", ")} />}
      {record.favorite && <Row label="Favorite" value="Yes" />}
      {record.notes && (
        <Text style={{ fontSize: 8, fontFamily: "Courier", marginTop: 4, color: "#3f3f54" }}>
          {record.notes.slice(0, 500)}{record.notes.length > 500 ? "…" : ""}
        </Text>
      )}
    </View>
  );
}

export function SignatureSection({ record }: SectionProps) {
  return (
    <View style={styles.section}>
      {record.pilotSignatureHash ? (
        <>
          <SectionTitle>Signature (Sealed)</SectionTitle>
          <Row label="Signed at" value={record.pilotSignedAt ? fmtDate(record.pilotSignedAt) : "—"} />
          <Row label="SHA-256" value={record.pilotSignatureHash.slice(0, 32) + "…"} />
        </>
      ) : (
        <>
          <SectionTitle>Signature</SectionTitle>
          <View style={styles.signatureBox}>
            <Text style={styles.signatureLabel}>Pilot signature</Text>
          </View>
          <Text style={{ fontSize: 7, color: "#6b6b7f", marginTop: 4 }}>Date: ____________</Text>
        </>
      )}
    </View>
  );
}

// ── Section ID → Component map ───────────────────────────────

export const SECTION_COMPONENTS: Record<string, React.FC<SectionProps>> = {
  "pilot-operator": PilotOperatorSection,
  "aircraft": AircraftSection,
  "flight-core": FlightCoreSection,
  "location": LocationSection,
  "weather": WeatherSection,
  "sun-moon": SunMoonSection,
  "wind": WindSection,
  "airspace": AirspaceSection,
  "events": EventsSection,
  "health": HealthSection,
  "phases": PhasesSection,
  "adherence": AdherenceSection,
  "geofence": GeofenceSection,
  "kpis": KpisSection,
  "preflight": PreflightSection,
  "loadout": LoadoutSection,
  "media": MediaSection,
  "notes": NotesSection,
  "signature": SignatureSection,
};
