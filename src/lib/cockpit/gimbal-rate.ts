/**
 * @module cockpit/gimbal-rate
 * @description The controller's analog gimbal pitch (L2 down, R2 up) as a
 * pitch rate on the drone's agent: `POST /api/v1/gimbal/rate` with
 * `{pitch_dps, yaw_dps, hold_ms}`. The agent zero-rates the gimbal itself when
 * a rate is not renewed within `hold_ms`, so a held trigger re-sends every
 * half hold, and letting go sends one zero rate for an immediate stop. An
 * agent without the route (404) or on a flight controller that cannot
 * rate-drive a gimbal (501) is left alone for the rest of the session.
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { timedFetch } from "@/lib/agent/agent-client/timeout";

/** How long the agent holds one rate before zeroing it itself. */
export const GIMBAL_RATE_HOLD_MS = 500;
/** Trigger travel below this reads as released. */
export const GIMBAL_TRIGGER_DEADBAND = 0.05;
/** The agent's rate limit. */
const MAX_DPS = 180;

export type GimbalRateSend = (droneId: string, pitchDps: number) => Promise<number | null>;

/** POST the rate to the drone's agent; resolves the HTTP status, or null
 * when the drone has no LAN agent or the request failed. */
export const postGimbalRate: GimbalRateSend = async (droneId, pitchDps) => {
  const agent = resolveLocalAgentForDrone(deviceIdFromNodeId(droneId) ?? droneId);
  if (!agent) return null;
  try {
    const res = await timedFetch(`${agent.agentUrl}/api/v1/gimbal/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(agent.apiKey ? { "X-ADOS-Key": agent.apiKey } : {}) },
      body: JSON.stringify({ pitch_dps: pitchDps, yaw_dps: 0, hold_ms: GIMBAL_RATE_HOLD_MS }),
    });
    return res.status;
  } catch {
    return null;
  }
};

/** Pitch rate for the two triggers (each 0..1), full travel = `fullDps`. */
export function triggerPitchDps(l2: number, r2: number, fullDps: number): number {
  const down = l2 > GIMBAL_TRIGGER_DEADBAND ? l2 : 0;
  const up = r2 > GIMBAL_TRIGGER_DEADBAND ? r2 : 0;
  const dps = (up - down) * fullDps;
  return Math.max(-MAX_DPS, Math.min(MAX_DPS, Math.round(dps * 10) / 10));
}

/**
 * Drives one drone's gimbal from the trigger values sampled each tick. Sends
 * on a rate change, re-sends every half hold while non-zero, and sends a
 * single zero on release.
 */
export class GimbalRateDriver {
  private last = 0;
  private sentAt = 0;
  private unsupported = false;

  constructor(
    private readonly droneId: string,
    private readonly fullDps: number,
    private readonly send: GimbalRateSend = postGimbalRate,
  ) {}

  tick(l2: number, r2: number, now: number): void {
    if (this.unsupported) return;
    const dps = triggerPitchDps(l2, r2, this.fullDps);
    const changed = dps !== this.last;
    const renew = dps !== 0 && now - this.sentAt >= GIMBAL_RATE_HOLD_MS / 2;
    if (!changed && !renew) return;
    this.last = dps;
    this.sentAt = now;
    void this.send(this.droneId, dps).then((status) => {
      if (status === 404 || status === 501) this.unsupported = true;
    });
  }

  /** Stop the gimbal if it is moving (the cockpit closed or the pad dropped). */
  stop(): void {
    if (this.last !== 0 && !this.unsupported) void this.send(this.droneId, 0);
    this.last = 0;
  }
}
