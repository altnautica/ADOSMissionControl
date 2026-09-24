/**
 * @module agent/agent-client/camera
 * @description Camera-roster methods for the agent REST client: the reconciled
 * roster read (`GET /api/video/roster`) and the operator write
 * (`PUT /api/video/roster`). Distinct from the legacy `extras.listCameras`
 * (`/api/video/cameras`, encoder role assignments) — this is the management
 * roster the Cameras surface renders + edits. Each takes a `RequestContext` so
 * the `AgentClient` class re-exposes them as instance methods.
 * @license GPL-3.0-only
 */

import type { CameraLegInput, RosterCamera } from "../feature-types";
import { coerceRoster, legsWithEdit } from "../camera-roster";
import { agentRequest, type RequestContext } from "./transport";

/** The reconciled camera roster (declared legs + discovered devices + live
 * state). Degrades to an empty list when the agent has no video pipeline. */
export async function getCameraRoster(
  ctx: RequestContext,
): Promise<RosterCamera[]> {
  const body = await agentRequest<{ cameras?: unknown }>(
    ctx,
    "/api/video/roster",
  );
  return coerceRoster(body?.cameras);
}

/** Persist the operator's declared leg list. The agent validates the list,
 * merges it by owner (preserving plugin-declared legs), and restarts the video
 * pipeline (~3 s), so callers show a restart indicator + re-read after. Throws
 * with the agent's message on a validation (400) / unreachable (503) failure. */
export async function setCameraRoster(
  ctx: RequestContext,
  cameras: CameraLegInput[],
): Promise<void> {
  await agentRequest<unknown>(ctx, "/api/video/roster", {
    method: "PUT",
    body: JSON.stringify({ cameras }),
    // The write dials the supervisor + restarts the pipeline; give it more
    // headroom than a plain read.
    timeoutMs: 15000,
  });
}

/** Make the camera at `devicePath` the primary stream. Camera roles live in
 * the roster, so this reads it, designates the matching row (by device path,
 * else by source) as `primary` through the same leg builder the Cameras
 * surface uses, and writes the list back; the agent restarts the pipeline
 * (~3 s). Throws when no roster row names the device, and with the agent's
 * message when the write is refused. */
export async function switchPrimaryCamera(
  ctx: RequestContext,
  devicePath: string,
): Promise<void> {
  const roster = await getCameraRoster(ctx);
  const cam =
    roster.find((c) => c.device_path === devicePath) ??
    roster.find((c) => c.source === devicePath);
  if (!cam) {
    throw new Error(`No camera at ${devicePath} in the node's camera roster`);
  }
  if (cam.role === "primary" && cam.enabled) return;
  await setCameraRoster(
    ctx,
    legsWithEdit(roster, cam.id, { role: "primary", enabled: true }),
  );
}
