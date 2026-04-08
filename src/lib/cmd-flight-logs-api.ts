/**
 * @module cmd-flight-logs-api
 * @description Typed Convex API references for the History tab cloud sync.
 * Mirrors the {@link cmdDronesApi} pattern from {@link community-api-drones}.
 * @license GPL-3.0-only
 */

import { api } from "../../convex/_generated/api";

export const cmdFlightLogsApi = {
  list: api.cmdFlightLogs.list,
  get: api.cmdFlightLogs.get,
  upsert: api.cmdFlightLogs.upsert,
  remove: api.cmdFlightLogs.remove,
  stats: api.cmdFlightLogs.stats,
};
