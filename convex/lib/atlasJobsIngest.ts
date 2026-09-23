/**
 * @module convex/lib/atlasJobsIngest
 * @description Request validation for `POST /agent/atlas-jobs`.
 *
 * A compute node (itself a paired fleet node) posts reconstruct jobs for a
 * capturing drone. Authentication and attribution are split: the POSTER is
 * proven by `posterDeviceId` + its `X-ADOS-Key`, while the job row is filed
 * under the body's `deviceId`, which reads are authorized against. So the
 * subject drone must belong to the poster's owner, or one valid device key
 * could file rows, with a chosen `outputUrl` the viewers load, into another
 * account's World Model tab.
 *
 * The decision is a pure function over the parsed body and a device lookup so
 * it can be unit-tested; the HTTP route only wires the lookup and the upsert.
 *
 * @license GPL-3.0-only
 */

import { agentKeyMatches } from "./credentials";
import { boundedField, jsonHeaders, numberField, stringField } from "./heartbeatFields";

/** The paired-device fields the decision reads. */
export interface AtlasJobDevice {
  apiKey?: string | null;
  userId: string;
}

/** Arguments for `cmdAtlasJobs.upsertJob`. */
export interface AtlasJobUpsert {
  deviceId: string;
  computeNodeId: string;
  kind: string;
  status: string;
  sessionId?: string;
  inputBag?: string;
  outputUrl?: string;
  derivedFrom?: string;
  metadata?: Record<string, unknown>;
  startedAt?: number;
  finishedAt?: number;
}

function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: jsonHeaders });
}

/**
 * Validate an atlas-job post. Returns the upsert arguments, or the error
 * `Response` to send: 400 for a missing field, an over-long string or a
 * non-http(s) `outputUrl`; 401 for an unknown poster or wrong key; 403 when the
 * subject drone is not owned by the poster's owner.
 */
export async function resolveAtlasJobPost(
  body: Record<string, unknown>,
  apiKey: string | undefined,
  lookupDevice: (deviceId: string) => Promise<AtlasJobDevice | null>,
): Promise<AtlasJobUpsert | Response> {
  const posterDeviceId = stringField(body, "posterDeviceId");
  const deviceId = stringField(body, "deviceId");
  const computeNodeId = stringField(body, "computeNodeId");
  const kind = stringField(body, "kind");
  const status = stringField(body, "status");
  if (!posterDeviceId || !apiKey || !deviceId || !computeNodeId || !kind || !status) {
    return refuse(
      400,
      "posterDeviceId, apiKey, deviceId, computeNodeId, kind, and status required",
    );
  }

  const poster = await lookupDevice(posterDeviceId);
  if (!poster || !agentKeyMatches(poster.apiKey, apiKey)) {
    return refuse(401, "Invalid device or API key");
  }
  if (deviceId !== posterDeviceId) {
    const subject = await lookupDevice(deviceId);
    if (!subject || subject.userId !== poster.userId) {
      return refuse(403, "Subject device is not in this fleet");
    }
  }

  // Every string below is persisted and rendered, so each has a length cap.
  const outputUrl = boundedField(body, "outputUrl", 2048);
  if (outputUrl instanceof Response) return outputUrl;
  if (outputUrl !== undefined && !/^https?:\/\//i.test(outputUrl)) {
    return refuse(400, "outputUrl must be an http(s) URL");
  }
  const sessionId = boundedField(body, "sessionId", 128);
  if (sessionId instanceof Response) return sessionId;
  const inputBag = boundedField(body, "inputBag", 512);
  if (inputBag instanceof Response) return inputBag;
  const derivedFrom = boundedField(body, "derivedFrom", 128);
  if (derivedFrom instanceof Response) return derivedFrom;

  // metadata is a free-form object (backend badge, viewer hint, gaussian
  // count); forwarded verbatim when it is a plain object, else omitted.
  const metadata =
    typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : undefined;

  return {
    deviceId,
    computeNodeId,
    kind,
    status,
    sessionId,
    inputBag,
    outputUrl,
    derivedFrom,
    metadata,
    startedAt: numberField(body, "startedAt"),
    finishedAt: numberField(body, "finishedAt"),
  };
}
