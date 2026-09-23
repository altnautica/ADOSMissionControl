/**
 * UI, view, flight history, and analytics types.
 * @module types/ui
 */

// ── UI ───────────────────────────────────────────────────────

export type ViewId =
  | "dashboard"
  | "plan"
  | "simulate"
  | "history"
  | "analytics"
  | "config"
  | "wizard";

export interface PanelState {
  telemetry: boolean;
  alerts: boolean;
  chat: boolean;
}

/** One choice in a picker. Board catalogs and enum tables build these. */
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** A labelled group of picker choices. */
export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

// ── Flight History ───────────────────────────────────────────

export type FlightEventSeverity = "info" | "warning" | "error";

export interface FlightEvent {
  /** Offset from flight start in milliseconds. */
  t: number;
  /** Event type — broad enough to extend without breaking existing rows. */
  type: string;
  severity: FlightEventSeverity;
  /** Short human label. */
  label: string;
  /** Optional structured data (channel name, threshold, etc.). */
  data?: Record<string, unknown>;
}

export interface FlightFlag {
  /** Stable id for the flag rule (e.g. `vibration_high`). */
  type: string;
  severity: FlightEventSeverity;
  message: string;
  /** Optional remediation hint. */
  suggestion?: string;
}

export interface HealthSummary {
  avgSatellites?: number;
  avgHdop?: number;
  maxVibrationRms?: number;
  batteryHealthPct?: number;
}

export interface FlightRecord {
  id: string;
  droneId: string;
  droneName: string;
  /** Legacy timestamp field — equals startTime. Kept for back-compat with existing components. */
  date: number;
  /** Flight start (arm) wall-clock time in ms epoch. */
  startTime: number;
  /**
   * True when the source log carried no clock time: `date`/`startTime`/`endTime`
   * are the import time, and the flight's real date is unknown.
   */
  startTimeUnknown?: boolean;
  /** Flight end (disarm) wall-clock time in ms epoch. Equals startTime while in_progress. */
  endTime: number;
  /** Duration in seconds. 0 while in_progress. */
  duration: number;
  /** Total ground distance in meters (haversine sum); undefined when the flight has no recorded telemetry. */
  distance?: number;
  /** Max altitude AGL in meters; undefined when the flight has no recorded telemetry. */
  maxAlt?: number;
  /** Max ground speed in m/s; undefined when the flight has no recorded telemetry. */
  maxSpeed?: number;
  /** Average ground speed in m/s. */
  avgSpeed?: number;
  /** Battery used percentage; undefined when the flight reported no usable battery data. */
  batteryUsed?: number;
  /** Battery voltage at arm. */
  batteryStartV?: number;
  /** Battery voltage at disarm. */
  batteryEndV?: number;
  waypointCount: number;
  status: "completed" | "aborted" | "emergency" | "in_progress";
  /** Downsampled path: [lat, lon][] at ~1 Hz, max 1000 points. */
  path?: [number, number][];
  takeoffLat?: number;
  takeoffLon?: number;
  landingLat?: number;
  landingLon?: number;
  /** IndexedDB recording id from telemetry-recorder, if a recording is attached. */
  recordingId?: string;
  /** True if a non-empty telemetry recording is attached. */
  hasTelemetry?: boolean;
  /** Last mutation time in ms epoch. */
  updatedAt: number;
  /** User-set favorite flag. */
  favorite?: boolean;
  /** User-set tags (free-form labels). */
  tags?: string[];
  /** User-overridden display name. Falls back to droneName/date when unset. */
  customName?: string;
  /** Markdown notes shown in the NotesTab. */
  notes?: string;
  /** Auto-detected events from the flight analyzer. */
  events?: FlightEvent[];
  /** Auto-detected anomaly flags. */
  flags?: FlightFlag[];
  /** Health summary stats. */
  health?: HealthSummary;

  // Frozen pilot/aircraft snapshot at flight time. Lets historical
  // records produce compliance exports even after the operator profile or
  // aircraft registry has been edited.
  pilotFirstName?: string;
  pilotLastName?: string;
  pilotLicenseNumber?: string;
  pilotLicenseIssuer?: string;
  aircraftRegistration?: string;
  aircraftSerial?: string;
  aircraftMtomKg?: number;

  // Sign-and-lock workflow.
  /** Wall-clock time the pilot sealed this record. */
  pilotSignedAt?: number;
  /** SHA-256 hex digest of the canonicalised record + optional signature image. */
  pilotSignatureHash?: string;

  /** True if this record has been successfully synced to Convex. */
  cloudSynced?: boolean;

  /** Origin of this record. */
  source?: "live" | "dataflash" | "imported" | "ulog" | "tlog";
  /** Original `.bin` / `.ulg` / `.tlog` filename when imported. */
  sourceFilename?: string;

  /** Frozen loadout snapshot at arm time (battery + equipment ids). */
  loadout?: LoadoutSnapshot;

  /** Pre-flight checklist + prearm bitmask snapshot at arm time. */
  preflight?: PreflightSnapshot;

  /** Sun / moon environmental snapshot at arm time. */
  sunMoon?: SunMoonSnapshot;

  /** METAR weather snapshot from the nearest reporting station. */
  weatherSnapshot?: WeatherSnapshot;

  // Reverse-geocoded human-readable location fields.
  /** Comma-joined place name at takeoff ("Bangalore, Karnataka, India"). */
  takeoffPlaceName?: string;
  /** Comma-joined place name at landing. Only set when landing is >5 km from takeoff. */
  landingPlaceName?: string;
  /** ISO 3166-1 alpha-2 country code from the takeoff lookup (e.g. "IN", "US"). */
  country?: string;
  /** State / province / region from the takeoff lookup. */
  region?: string;
  /** City / town / village from the takeoff lookup. */
  locality?: string;

  /** Derived flight phase segmentation. */
  phases?: FlightPhase[];

  // Mission adherence (intended vs actual).
  /** Mission id from the active mission at arm time. */
  missionId?: string;
  /** Mission name from the active mission at arm time. */
  missionName?: string;
  /** Frozen waypoint snapshot. Present when an active mission was loaded at arm. */
  missionWaypoints?: { lat: number; lon: number; alt: number }[];
  /** Computed adherence stats from comparing the actual path against the intended waypoints. */
  adherence?: MissionAdherence;

  // Geofence forensics.
  /** Frozen geofence configuration at arm time. */
  geofenceSnapshot?: GeofenceSnapshot;
  /** Detected breaches against the snapshotted geofence. */
  geofenceBreaches?: GeofenceBreach[];

  /** Wind vector estimated from FC telemetry (VFR_HUD airspeed vs groundspeed). */
  windEstimate?: WindEstimate;

  /** Media files linked to this flight. */
  media?: FlightMedia[];

  /** Soft-delete. When true, the record is in the trash. */
  deleted?: boolean;
  /** Timestamp when the record was soft-deleted. */
  deletedAt?: number;
}

/** A photo or video file linked to a flight. */
export interface FlightMedia {
  id: string;
  /** Original filename. */
  name: string;
  /** MIME type (image/jpeg, video/mp4, etc.). */
  type: string;
  /** File size in bytes. */
  size: number;
  /** Capture timestamp from EXIF (ms epoch), or file modification time if no EXIF. */
  capturedAt: number;
  /** GPS latitude from EXIF, if present. */
  lat?: number;
  /** GPS longitude from EXIF, if present. */
  lon?: number;
  /** Camera altitude from EXIF, if present. */
  alt?: number;
  /** IDB key where the blob is stored. */
  blobKey: string;
}

/** Frozen geofence configuration captured at flight arm time. */
export interface GeofenceSnapshot {
  enabled: boolean;
  maxAltitude?: number;
  minAltitude?: number;
  /** Inclusion + exclusion zones at arm time. */
  zones?: GeofenceSnapshotZone[];
}

export interface GeofenceSnapshotZone {
  id: string;
  role: "inclusion" | "exclusion";
  type: "polygon" | "circle";
  polygonPoints?: [number, number][];
  circleCenter?: [number, number];
  circleRadius?: number;
}

/** One contiguous run of path points that breached the snapshotted geofence. */
export interface GeofenceBreach {
  /** Index of the first path point in the breach run. */
  startIdx: number;
  /** Index of the last path point in the breach run. */
  endIdx: number;
  type:
    | "polygon_outside"
    | "polygon_inside"
    | "circle_outside"
    | "circle_inside"
    | "max_altitude"
    | "min_altitude";
  /** Zone id from the snapshot, or "altitude" for altitude breaches. */
  zoneId: string;
  /** Peak breach distance in meters. */
  maxBreachDistanceM?: number;
  /** Path index where the peak breach occurred. */
  peakIdx?: number;
}

/** Mission adherence stats from {@link computeAdherence}. */
export interface MissionAdherence {
  /** Total number of waypoints in the mission. */
  totalWaypoints: number;
  /** How many waypoints the actual path passed within the hit radius. */
  waypointsReached: number;
  /** Max distance from any path point to the closest mission leg, in meters. */
  maxCrossTrackErrorM: number;
  /** Mean cross-track error in meters. */
  meanCrossTrackErrorM: number;
  /** Path-index ranges where the deviation exceeded the threshold. */
  deviationSegments?: {
    startIdx: number;
    endIdx: number;
    maxErrorM: number;
  }[];
}

/**
 * One segment of the flight classified by motion state. Derived by
 * {@link detectPhases} from the recorded position frames (height above home)
 * and frozen into FlightRecord at disarm.
 */
export interface FlightPhase {
  type:
    | "pre_arm"
    | "takeoff"
    | "climb"
    | "cruise"
    | "hover"
    | "descent"
    | "land"
    | "post_disarm";
  /** Offset from flight start (ms). */
  startMs: number;
  endMs: number;
  /** Average groundspeed during this phase in m/s, if any position frames exist. */
  avgSpeed?: number;
  /** Max altitude reached during this phase in m AGL. */
  maxAlt?: number;
}

/**
 * METAR weather snapshot captured at arm time from the nearest aviation
 * weather station (within 300 km). Fetched async so it doesn't block the
 * arm path — undefined when the network is down or no station is in range.
 *
 * Feeds the Overview "Conditions" card and jurisdictions that care about
 * wind / visibility (insurance reporting, litigation evidence, go/no-go
 * audit trails).
 */
export interface WeatherSnapshot {
  /** ISO timestamp of the METAR observation (not the flight time). */
  observedAt: string;
  /** ICAO code of the reporting station (e.g. "VOBL", "EGLL"). */
  stationIcao: string;
  /** Friendly station name, typically "<airport>, <city>, <country>". */
  stationName?: string;
  stationLat?: number;
  stationLon?: number;
  /** Distance from the flight's arm position to the station in km. */
  stationDistanceKm?: number;
  tempC?: number;
  dewPointC?: number;
  /**
   * Wind direction in compass degrees (0–360). Undefined when the report
   * gives a variable (VRB) direction or none at all.
   */
  windDirDeg?: number;
  windKts?: number;
  gustKts?: number;
  /** Horizontal visibility in statute miles. "6+" is represented as 6. */
  visibilityMi?: number;
  /** Ceiling (lowest BKN or OVC layer) in feet AGL. */
  ceilingFtAgl?: number;
  /** Altimeter setting in hectopascals (hPa). */
  altimeterHpa?: number;
  /** FAA flight category derived from ceiling + visibility. */
  flightCategory?: "VFR" | "MVFR" | "IFR" | "LIFR";
  /** Raw METAR string for audit trail. */
  rawMetar?: string;
  /** Set when the fetch or parse failed; the snapshot is still serialized so the UI can show the error. */
  error?: string;
}

/**
 * Sun + moon snapshot for the flight's arm-time position and instant.
 * Pure compute from `src/lib/environment/sun-moon.ts` — no network.
 * Feeds the Overview "Conditions" card and jurisdictions that care about
 * day-vs-night operations (EASA Open, UK CAA, CASA ReOC).
 */
export interface SunMoonSnapshot {
  /** ISO timestamp of the compute reference instant (flight startTime). */
  computedAt: string;
  /** Latitude used for the computation. */
  lat: number;
  /** Longitude used for the computation. */
  lon: number;

  // Solar day markers (ISO). Undefined near polar circles when not defined.
  sunriseIso?: string;
  sunsetIso?: string;
  /** Civil twilight start (dawn). */
  civilDawnIso?: string;
  /** Civil twilight end (dusk). */
  civilDuskIso?: string;
  goldenHourMorningStartIso?: string;
  goldenHourMorningEndIso?: string;
  goldenHourEveningStartIso?: string;
  goldenHourEveningEndIso?: string;

  /** Daylight phase at `computedAt` — classified from sun altitude. */
  daylightPhase:
    | "day"
    | "civil_twilight"
    | "nautical_twilight"
    | "astronomical_twilight"
    | "night";
  /** True iff `computedAt` fell inside either golden-hour window. */
  inGoldenHour: boolean;

  /** Sun altitude in degrees at `computedAt` (negative = below horizon). */
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;

  /** Moon-phase fraction in [0, 1] (new=0, first quarter=0.25, full=0.5, last quarter=0.75). */
  moonPhase: number;
  /** Fraction of the moon's visible disk illuminated (0..1). */
  moonIllumination: number;
  /** Human label such as "Waxing crescent", "Full moon". */
  moonPhaseLabel: string;
  moonAltitudeDeg: number;
  moonAzimuthDeg: number;
}

/**
 * Snapshot of the pre-flight state at arm time. Used by the History
 * Overview "Pre-flight" card and by jurisdiction validators (CASA in
 * particular requires the actual checklist contents).
 */
export interface PreflightSnapshot {
  /** Checklist session id from useChecklistStore. */
  checklistSessionId?: string;
  checklistStartedAt?: number;
  /** Each item's id + status at arm time, frozen. */
  checklistItems?: PreflightChecklistItem[];
  /** True iff every checklist item was pass or skipped. */
  checklistComplete?: boolean;
  /** Latest SYS_STATUS health bitmask at arm time. */
  sysStatusHealth?: number;
  /** Latest SYS_STATUS sensors-present bitmask at arm time. */
  sysStatusPresent?: number;
  /** Latest SYS_STATUS sensors-enabled bitmask at arm time. */
  sysStatusEnabled?: number;
  /** Recent ArduPilot STATUSTEXT lines starting with "PreArm:" (most recent ≤10). */
  prearmFailures?: string[];
}

export interface PreflightChecklistItem {
  id: string;
  category: string;
  label: string;
  status: "pending" | "pass" | "fail" | "skipped";
  type: "auto" | "manual";
  /** Captured display value for auto items at arm time (e.g. "98 sats", "12.4V"). */
  displayValue?: string;
}

/** Equipment + battery ids fitted to the drone for one specific flight. */
export interface LoadoutSnapshot {
  /** Battery pack ids (typically one for series, multiple for parallel packs). */
  batteryIds?: string[];
  propSetId?: string;
  motorSetId?: string;
  escSetId?: string;
  cameraId?: string;
  gimbalId?: string;
  payloadId?: string;
  frameId?: string;
  rcTxId?: string;
}

/**
 * Estimated wind vector for a flight. `fc_estimate` averages the
 * autopilot's own wind estimate; `vfr_diff` subtracts the air velocity
 * (VFR_HUD airspeed along the heading, only with an airspeed sensor) from
 * the ground-track velocity.
 */
export interface WindEstimate {
  /** Estimated wind speed in m/s. */
  speedMs: number;
  /** Compass direction the wind is blowing FROM (0–360°, 0 = north). */
  fromDirDeg: number;
  /** Number of valid telemetry frames used in the estimate. */
  sampleCount: number;
  /** Estimation method. */
  method: "vfr_diff" | "fc_estimate";
}

// ── Analytics ────────────────────────────────────────────────

export interface AnalyticsData {
  totalFlights: number;
  totalFlightTime: number;    // seconds
  totalDistance: number;       // meters
  avgFlightTime: number;       // seconds
  avgBatteryUsed: number;      // percentage
  missionSuccessRate: number;  // percentage
  flightsPerDay: { date: string; count: number }[];
  utilizationByDrone: { droneId: string; droneName: string; hours: number }[];
  batteryDegradation: { date: string; avgCapacity: number }[];
}
