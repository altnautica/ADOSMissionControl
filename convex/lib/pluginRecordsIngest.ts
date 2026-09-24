/**
 * @module convex/lib/pluginRecordsIngest
 * @description Bounds for plugin-owned cloud records, and request validation
 * for `POST /agent/plugin-records`.
 *
 * A plugin's agent half files records through its node: the POSTER is proven
 * by `posterDeviceId` + its `X-ADOS-Key`, and the record may name a subject
 * `deviceId` (e.g. a compute node filing a job about a drone). The subject
 * must belong to the poster's owner, or one valid device key could file rows
 * into another account's plugin history.
 *
 * The decision is a pure function over the parsed body and a device lookup so
 * it can be unit-tested; the HTTP route wires the lookup and the write, and
 * the write re-checks the plugin's `cloud.records` grant inside its own
 * transaction.
 *
 * @license GPL-3.0-only
 */

import { agentKeyMatches } from "./credentials";
import { jsonHeaders, stringField } from "./heartbeatFields";

/** Capability a plugin half needs to read or write its cloud records. */
export const CLOUD_RECORDS_CAPABILITY = "cloud.records";

/** Largest JSON-encoded record body, in UTF-8 bytes. */
export const MAX_RECORD_BYTES = 64 * 1024;

/** Most records one plugin may hold for one user. */
export const MAX_RECORDS_PER_PLUGIN = 5000;

/** Longest record key. */
export const MAX_RECORD_KEY_LENGTH = 256;

/** Longest plugin id (reverse-DNS). */
export const MAX_PLUGIN_ID_LENGTH = 128;

const COLLECTION_RE = /^[a-z0-9_.-]{1,64}$/;
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** A reverse-DNS plugin id within the length cap. */
export function isValidPluginId(value: string): boolean {
  return value.length <= MAX_PLUGIN_ID_LENGTH && PLUGIN_ID_RE.test(value);
}

/** A collection name: 1-64 of `[a-z0-9_.-]`. */
export function isValidCollection(value: string): boolean {
  return COLLECTION_RE.test(value);
}

/** A non-empty key within the length cap. */
export function isValidRecordKey(value: string): boolean {
  return value.length > 0 && value.length <= MAX_RECORD_KEY_LENGTH;
}

/**
 * UTF-8 byte length of `data` encoded as JSON, or `null` when it does not
 * encode (undefined, a function, a cycle).
 */
export function recordDataBytes(data: unknown): number | null {
  let json: string | undefined;
  try {
    json = JSON.stringify(data);
  } catch {
    return null;
  }
  if (json === undefined) return null;
  return new TextEncoder().encode(json).length;
}

/** The paired-device fields the decision reads. */
export interface PluginRecordDevice {
  apiKey?: string | null;
  userId: string;
}

/** A validated agent record write, ready for `pluginRecords.ingestFromAgent`. */
export interface PluginRecordPost {
  userId: string;
  posterDeviceId: string;
  pluginId: string;
  collection: string;
  key: string;
  deviceId: string;
  data: unknown;
  sizeBytes: number;
}

function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: jsonHeaders });
}

/**
 * Validate a plugin-record post. Returns the write, or the error `Response` to
 * send: 400 for a missing or malformed field; 401 for an unknown poster or
 * wrong key; 403 when the subject device is not owned by the poster's owner;
 * 413 when the record body exceeds the size cap. The subject defaults to the
 * poster.
 */
export async function resolvePluginRecordPost(
  body: Record<string, unknown>,
  apiKey: string | undefined,
  lookupDevice: (deviceId: string) => Promise<PluginRecordDevice | null>,
): Promise<PluginRecordPost | Response> {
  const posterDeviceId = stringField(body, "posterDeviceId");
  const pluginId = stringField(body, "pluginId");
  const collection = stringField(body, "collection");
  const key = stringField(body, "key");
  if (!posterDeviceId || !apiKey || !pluginId || !collection || key === undefined) {
    return refuse(400, "posterDeviceId, apiKey, pluginId, collection, and key required");
  }
  if (!("data" in body)) return refuse(400, "data required");

  const poster = await lookupDevice(posterDeviceId);
  if (!poster || !agentKeyMatches(poster.apiKey, apiKey)) {
    return refuse(401, "Invalid device or API key");
  }
  const bodyDeviceId = body.deviceId;
  if (bodyDeviceId !== undefined && typeof bodyDeviceId !== "string") {
    return refuse(400, "deviceId must be a string");
  }
  const deviceId = bodyDeviceId ?? posterDeviceId;
  if (deviceId !== posterDeviceId) {
    const subject = await lookupDevice(deviceId);
    if (!subject || subject.userId !== poster.userId) {
      return refuse(403, "Subject device is not in this fleet");
    }
  }

  if (!isValidPluginId(pluginId)) return refuse(400, "pluginId must be a reverse-DNS id");
  if (!isValidCollection(collection)) {
    return refuse(400, "collection must be 1-64 of [a-z0-9_.-]");
  }
  if (!isValidRecordKey(key)) {
    return refuse(400, `key must be 1-${MAX_RECORD_KEY_LENGTH} characters`);
  }
  const sizeBytes = recordDataBytes(body.data);
  if (sizeBytes === null) return refuse(400, "data must be JSON");
  if (sizeBytes > MAX_RECORD_BYTES) {
    return refuse(413, `data exceeds ${MAX_RECORD_BYTES} bytes`);
  }

  return {
    userId: poster.userId,
    posterDeviceId,
    pluginId,
    collection,
    key,
    deviceId,
    data: body.data,
    sizeBytes,
  };
}
