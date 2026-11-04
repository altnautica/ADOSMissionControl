/**
 * @module agent/agent-client/setup
 * @description Setup wizard surface — status, hardware-check, and the LCD
 * display sub-flows.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import type { HardwareCheckStatus, SetupStatus } from "../agent-api.generated";
import { HardwareCheckStatusSchema, SetupStatusSchema } from "../schemas";
import { agentRequest, type RequestContext } from "./transport";

export function getSetupStatus(ctx: RequestContext): Promise<SetupStatus> {
  return agentRequest<SetupStatus>(ctx, "/api/v1/setup/status", {
    // The schema checks the subset the GCS depends on; the generated type is
    // the wire contract.
    schema: SetupStatusSchema as unknown as z.ZodType<SetupStatus>,
    allowSchemaFallback: true,
  });
}

/** Per-component hardware-check snapshot for the active profile + role. */
export function getHardwareCheck(
  ctx: RequestContext,
): Promise<HardwareCheckStatus> {
  return agentRequest<HardwareCheckStatus>(ctx, "/api/v1/setup/hardware-check", {
    schema: HardwareCheckStatusSchema as z.ZodType<HardwareCheckStatus>,
    allowSchemaFallback: true,
  });
}

/** Re-run the hardware-check sweep on demand. Uncached. */
export function refreshHardwareCheck(
  ctx: RequestContext,
): Promise<HardwareCheckStatus> {
  return agentRequest<HardwareCheckStatus>(
    ctx,
    "/api/v1/setup/hardware-check/refresh",
    {
      method: "POST",
      schema: HardwareCheckStatusSchema as z.ZodType<HardwareCheckStatus>,
      allowSchemaFallback: true,
    },
  );
}

/** Switch the active page rendered on the agent's local LCD. */
export function setDisplayPage(
  ctx: RequestContext,
  page: string,
): Promise<{ ok?: boolean; activePage?: string }> {
  return agentRequest<{ ok?: boolean; activePage?: string }>(
    ctx,
    "/api/v1/display/page",
    {
      method: "POST",
      body: JSON.stringify({ page }),
    },
  );
}

/**
 * Request the on-device touch calibration wizard. The agent drops a
 * one-shot flag its LCD service consumes on the next render tick and
 * launches the full-screen target capture on the panel itself (touch
 * calibration is physical — the operator taps the crosshairs on the
 * device). Completion is reflected back through the heartbeat's
 * `touchCalibrated` flag, not a remote step poll.
 */
export function startDisplayCalibration(
  ctx: RequestContext,
): Promise<{ ok?: boolean; message?: string }> {
  return agentRequest<{ ok?: boolean; message?: string }>(
    ctx,
    "/api/v1/setup/display/calibrate/start",
    { method: "POST" },
  );
}

/** Response of `POST /api/v1/display/calibrate/start`. The agent only queues
 * the request for the display service; `target_count` is the crosshair count
 * of the on-panel wizard. There is no remote step counter. `request_id`
 * names this start in the status poll. */
export interface TouchCalibrationStart {
  requested: boolean;
  target_count: number;
  request_id: string;
}

/** State from `GET /api/v1/display/calibrate/status`. `calibrated` is a fit
 * on disk newer than the latest start (`request_id`; null when none was made
 * since the agent API came up, in which case it is just "a fit exists").
 * `calib_mtime_ms` is the fit file's mtime, null when there is none.
 * `requested` stays true while a start request is queued and the display
 * service has not picked it up (it stays true when no display service is
 * running). */
export interface TouchCalibrationStatus {
  calibrated: boolean;
  requested: boolean;
  request_id: string | null;
  calib_mtime_ms: number | null;
}

/**
 * Ask the HDMI kiosk panel to open its touch-calibration wizard. Distinct from
 * `startDisplayCalibration` (the SPI-LCD setup route). The wizard runs on the
 * panel, where the operator taps the crosshairs; the result appears in
 * {@link getTouchCalibrationStatus} as `calibrated` once the fit is saved.
 */
export function startTouchCalibration(
  ctx: RequestContext,
): Promise<TouchCalibrationStart> {
  return agentRequest<TouchCalibrationStart>(
    ctx,
    "/api/v1/display/calibrate/start",
    { method: "POST" },
  );
}

/** Read the live touch-calibration state for the kiosk card poll. */
export function getTouchCalibrationStatus(
  ctx: RequestContext,
): Promise<TouchCalibrationStatus> {
  return agentRequest<TouchCalibrationStatus>(
    ctx,
    "/api/v1/display/calibrate/status",
  );
}

/** Per-section result of a setup apply. */
export interface SetupApplySection {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/** Body of `POST /api/v1/setup/apply`: `overall` is false when any section
 * failed; `rolled_back` names sections reverted after that failure. */
export interface SetupApplyResponse {
  overall: boolean;
  sections: Record<string, SetupApplySection>;
  rolled_back: string[];
}

/** Apply a partial setup update, e.g. the LCD theme
 * (`{ ui: { theme } }`) or the regulatory posture
 * (`{ regulatory: { mode, region } }`). */
export function applySetup(
  ctx: RequestContext,
  update: Record<string, unknown>,
): Promise<SetupApplyResponse> {
  return agentRequest<SetupApplyResponse>(ctx, "/api/v1/setup/apply", {
    method: "POST",
    body: JSON.stringify(update),
  });
}
