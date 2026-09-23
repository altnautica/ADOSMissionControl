/**
 * Local FlightRecord <-> `cmd_flightLogs` row mapping for the cloud sync.
 *
 * The upsert validator rejects any key it does not declare, so the payload is
 * built from an explicit list of synced fields instead of forwarding the whole
 * record. The list is a `Record` over every FlightRecord key: adding a field
 * to FlightRecord fails to compile until it is classified here as synced or
 * local-only, and the synced list is checked against the validator in tests.
 *
 * @license GPL-3.0-only
 */

import type { FlightRecord } from "@/lib/types";

/** Fields that never leave the device. */
type LocalOnlyKey =
  /** Mapped to the row's `clientId`. */
  | "id"
  /** Legacy alias of `startTime`; rebuilt from it on the way back. */
  | "date"
  /** Sync bookkeeping. */
  | "cloudSynced";

export type SyncedFlightKey = Exclude<keyof FlightRecord, LocalOnlyKey>;

const SYNCED: Record<SyncedFlightKey, true> = {
  droneId: true,
  droneName: true,
  startTime: true,
  endTime: true,
  duration: true,
  distance: true,
  maxAlt: true,
  maxSpeed: true,
  avgSpeed: true,
  batteryUsed: true,
  batteryStartV: true,
  batteryEndV: true,
  waypointCount: true,
  status: true,
  path: true,
  takeoffLat: true,
  takeoffLon: true,
  landingLat: true,
  landingLon: true,
  recordingId: true,
  hasTelemetry: true,
  updatedAt: true,
  favorite: true,
  tags: true,
  customName: true,
  notes: true,
  events: true,
  flags: true,
  health: true,
  pilotFirstName: true,
  pilotLastName: true,
  pilotLicenseNumber: true,
  pilotLicenseIssuer: true,
  aircraftRegistration: true,
  aircraftSerial: true,
  aircraftMtomKg: true,
  pilotSignedAt: true,
  pilotSignatureHash: true,
  source: true,
  sourceFilename: true,
  loadout: true,
  preflight: true,
  sunMoon: true,
  weatherSnapshot: true,
  takeoffPlaceName: true,
  landingPlaceName: true,
  country: true,
  region: true,
  locality: true,
  phases: true,
  missionId: true,
  missionName: true,
  missionWaypoints: true,
  adherence: true,
  geofenceSnapshot: true,
  geofenceBreaches: true,
  windEstimate: true,
  media: true,
  deleted: true,
  deletedAt: true,
};

/** Every FlightRecord field the cloud row stores. */
export const SYNCED_FLIGHT_KEYS = Object.keys(SYNCED) as SyncedFlightKey[];

export type CloudFlightRow = Partial<Pick<FlightRecord, SyncedFlightKey>> & { clientId: string };

/** Build the upsert payload: synced fields only, `id` as `clientId`, absent fields omitted. */
export function toCloudShape(record: FlightRecord): CloudFlightRow {
  const row: Record<string, unknown> = { clientId: record.id };
  for (const key of SYNCED_FLIGHT_KEYS) {
    const value = record[key];
    if (value !== undefined) row[key] = value;
  }
  return row as CloudFlightRow;
}

/**
 * Translate a cloud row (`clientId` + `_id` + `_creationTime` + `userId`)
 * back into the local FlightRecord shape. `date` is not stored in the cloud,
 * so it is rebuilt from `startTime`.
 */
export function fromCloudShape(row: Record<string, unknown>): FlightRecord {
  const { _id, _creationTime, userId, clientId, ...rest } = row as Record<string, unknown> & {
    clientId: string;
  };
  void _id;
  void _creationTime;
  void userId;
  const record = { ...rest, id: clientId } as unknown as FlightRecord;
  return { ...record, date: record.startTime };
}
