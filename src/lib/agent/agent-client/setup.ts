/**
 * @module agent/agent-client/setup
 * @description Setup wizard surface — status, profile choice,
 * hardware-check, and the LCD display sub-flows.
 * @license GPL-3.0-only
 */

import type { z } from "zod";
import type {
  HardwareCheckStatus,
  SetupActionResult,
  SetupStatus,
} from "../types";
import {
  HardwareCheckStatusSchema,
  SetupActionResultSchema,
  SetupStatusSchema,
} from "../schemas";
import { agentRequest, type RequestContext } from "./transport";

export function getSetupStatus(ctx: RequestContext): Promise<SetupStatus> {
  return agentRequest<SetupStatus>(ctx, "/api/v1/setup/status", {
    schema: SetupStatusSchema as z.ZodType<SetupStatus>,
    allowSchemaFallback: true,
  });
}

/**
 * Persist the operator's profile choice from the onboarding wizard.
 * Pass `ground_role` only when `profile === "ground_station"`.
 */
export function postProfileChoice(
  ctx: RequestContext,
  profile: "drone" | "ground_station",
  ground_role?: "direct" | "relay" | "receiver" | null,
): Promise<SetupActionResult> {
  const body: { profile: string; ground_role?: string | null } = { profile };
  if (profile === "ground_station") {
    body.ground_role = ground_role ?? "direct";
  }
  return agentRequest<SetupActionResult>(ctx, "/api/v1/setup/profile", {
    method: "POST",
    body: JSON.stringify(body),
    schema: SetupActionResultSchema as z.ZodType<SetupActionResult>,
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

/** Response of `POST /api/v1/display/calibrate/start`. `target_count` is
 * the number of crosshairs the operator taps on the panel — the GCS shows
 * `step / target_count` progress while the on-panel wizard collects samples. */
export interface TouchCalibrationStart {
  job_id?: string;
  target_count?: number;
  current_step?: number;
}

/** Live state from `GET /api/v1/display/calibrate/status`. `calibrated` is
 * the on-disk result (the panel has a stored affine), `in_progress` reflects
 * a running wizard, `current_step` advances as the operator taps each
 * crosshair, and `rms_residual_px` is the fit residual once it lands. */
export interface TouchCalibrationStatus {
  calibrated?: boolean;
  in_progress?: boolean;
  current_step?: number;
  rms_residual_px?: number;
}

/**
 * Arm the on-panel touch-calibration wizard for the HDMI kiosk display.
 * Distinct from `startDisplayCalibration` (the SPI-LCD setup route): this
 * drives the `/api/v1/display/calibrate/*` flow the kiosk card polls, so the
 * GCS can show live `step / target_count` progress while the operator taps
 * the crosshairs shown on the HDMI panel. Returns the target count.
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

/** Apply a partial setup config update. Used here to push the LCD
 * theme choice (`{ ui: { theme: "dark" | "light" } }`). */
export function applySetup(
  ctx: RequestContext,
  update: Record<string, unknown>,
): Promise<{ ok?: boolean }> {
  return agentRequest<{ ok?: boolean }>(ctx, "/api/v1/setup/apply", {
    method: "POST",
    body: JSON.stringify(update),
  });
}
