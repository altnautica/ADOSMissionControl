/**
 * @module api/agent/sensors
 * @description REST client for a node's rig sensors, session clock, capture
 * storage and battery gauge (`/api/v1/sensors`, `/api/v1/clock`,
 * `/api/v1/storage`, `/api/v1/battery`, `PUT /api/v1/sensors/rig`), plus the
 * capture-session list the Capture extension serves on its plugin route
 * mount. Same transport as the ground-station modules: the node's own origin
 * (or a relay-proxy prefix) with its API key or dashboard PIN session.
 * @license GPL-3.0-only
 */

import { isDemoMode } from "@/lib/utils";
import { BatteryHealthSchema, type BatteryHealth } from "@/lib/agent/schemas/battery";
import {
  GroundStationApiError,
  gsRequest,
  type RequestContext,
} from "@/lib/api/ground-station/request";
import type {
  CaptureSessionSummary,
  ClockStatus,
  RigWriteResult,
  SensorsStatus,
  StorageStatus,
} from "./sensors-types";

export type * from "./sensors-types";

/** The Capture extension's plugin id; its routes sit under the agent's
 * plugin passthrough `/api/plugins/{id}/x/`. */
export const CAPTURE_PLUGIN_ID = "com.altnautica.capture";

export function getSensors(ctx: RequestContext): Promise<SensorsStatus> {
  return gsRequest<SensorsStatus>(ctx, "/api/v1/sensors");
}

export function getClock(ctx: RequestContext): Promise<ClockStatus> {
  return gsRequest<ClockStatus>(ctx, "/api/v1/clock");
}

export function getStorage(ctx: RequestContext): Promise<StorageStatus> {
  return gsRequest<StorageStatus>(ctx, "/api/v1/storage");
}

export async function getBattery(ctx: RequestContext): Promise<BatteryHealth> {
  return BatteryHealthSchema.parse(await gsRequest<unknown>(ctx, "/api/v1/battery"));
}

/** Store a contract `rig.json` document on the node. A document the node's
 * Rig schema rejects comes back as a 400 `E_RIG_INVALID` error. */
export function putRig(ctx: RequestContext, rig: unknown): Promise<RigWriteResult> {
  return gsRequest<RigWriteResult>(ctx, "/api/v1/sensors/rig", {
    method: "PUT",
    body: JSON.stringify(rig),
  });
}

/**
 * The node's capture sessions, newest first, or null when the Capture
 * extension is not installed or not running on it (its route is absent).
 */
export async function listCaptureSessions(
  ctx: RequestContext,
): Promise<CaptureSessionSummary[] | null> {
  try {
    const body = await gsRequest<{ sessions: CaptureSessionSummary[] }>(
      ctx,
      `/api/plugins/${encodeURIComponent(CAPTURE_PLUGIN_ID)}/x/capture/sessions`,
    );
    return [...body.sessions].sort((a, b) => b.started_at_utc.localeCompare(a.started_at_utc));
  } catch (err) {
    if (err instanceof GroundStationApiError && (err.status === 404 || err.status === 503)) {
      return null;
    }
    throw err;
  }
}

/** A typed client bound to one node. */
export class NodeSensorsApi {
  private readonly ctx: RequestContext;
  constructor(baseUrl: string, apiKey?: string | null) {
    this.ctx = { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey: apiKey ?? null };
  }
  /** The agent origin this client targets; tags store loads with their node. */
  get baseUrl(): string {
    return this.ctx.baseUrl;
  }
  getSensors = () => getSensors(this.ctx);
  getClock = () => getClock(this.ctx);
  getStorage = () => getStorage(this.ctx);
  getBattery = () => getBattery(this.ctx);
  putRig = (rig: unknown) => putRig(this.ctx, rig);
  listCaptureSessions = () => listCaptureSessions(this.ctx);
}

/** Build a client from the node's connection. Null in demo mode (the demo
 * agent URL has no REST endpoint; the demo seeds the store instead) and with
 * no agent URL. */
export function nodeSensorsApiFromAgent(
  agentUrl: string | null,
  apiKey: string | null,
): NodeSensorsApi | null {
  if (isDemoMode()) return null;
  if (!agentUrl) return null;
  return new NodeSensorsApi(agentUrl, apiKey);
}
