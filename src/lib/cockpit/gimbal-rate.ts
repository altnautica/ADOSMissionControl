/**
 * @module cockpit/gimbal-rate
 * @description The controller's analog gimbal pitch (L2 down, R2 up) as a
 * pitch rate on the drone's agent: `POST /api/v1/gimbal/rate` with
 * `{pitch_dps, yaw_dps, hold_ms}`, and the on-screen gimbal pad's pitch and
 * yaw. The agent zero-rates the gimbal itself when a rate is not renewed
 * within `hold_ms`, so a held rate is re-sent every half hold, and letting go
 * sends a zero rate for an immediate stop. `GET` on the same route says
 * whether the drone takes rates now.
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { timedFetch } from "@/lib/agent/agent-client/timeout";

/** How long the agent holds one rate before zeroing it itself. */
export const GIMBAL_RATE_HOLD_MS = 500;
/** Trigger travel below this reads as released. */
export const GIMBAL_TRIGGER_DEADBAND = 0.05;
/** Rates go out in steps of this many °/s, so trigger jitter sends nothing. */
export const GIMBAL_RATE_STEP_DPS = 5;
/** At most one rate change per this interval (about 10 Hz). */
export const GIMBAL_RATE_MIN_INTERVAL_MS = 100;
/** After a 429 from the agent's rate limit, wait this long before the next request. */
export const GIMBAL_RATE_BACKOFF_MS = 1000;
/** The agent's rate limit. */
const MAX_DPS = 180;

export type GimbalRateSend = (droneId: string, pitchDps: number, yawDps: number) => Promise<number | null>;

function agentFor(droneId: string) {
  return resolveLocalAgentForDrone(deviceIdFromNodeId(droneId) ?? droneId);
}

/** POST the rate to the drone's agent; resolves the HTTP status, or null
 * when the drone has no LAN agent or the request failed. */
export const postGimbalRate: GimbalRateSend = async (droneId, pitchDps, yawDps) => {
  const agent = agentFor(droneId);
  if (!agent) return null;
  try {
    const res = await timedFetch(`${agent.agentUrl}/api/v1/gimbal/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(agent.apiKey ? { "X-ADOS-Key": agent.apiKey } : {}) },
      body: JSON.stringify({ pitch_dps: pitchDps, yaw_dps: yawDps, hold_ms: GIMBAL_RATE_HOLD_MS }),
    });
    return res.status;
  } catch {
    return null;
  }
};

/**
 * Whether the drone's agent takes gimbal rates now (`GET
 * /api/v1/gimbal/rate` → `{available, reason}`). An agent without the route
 * (404), a drone with no LAN agent or a failed request reads unavailable.
 */
export async function gimbalRateAvailable(droneId: string): Promise<boolean> {
  const agent = agentFor(droneId);
  if (!agent) return false;
  try {
    const res = await timedFetch(`${agent.agentUrl}/api/v1/gimbal/rate`, {
      headers: agent.apiKey ? { "X-ADOS-Key": agent.apiKey } : {},
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { available?: unknown };
    return body.available === true;
  } catch {
    return false;
  }
}

/** Pitch rate for the two triggers (each 0..1), full travel = `fullDps`. */
export function triggerPitchDps(l2: number, r2: number, fullDps: number): number {
  const down = l2 > GIMBAL_TRIGGER_DEADBAND ? l2 : 0;
  const up = r2 > GIMBAL_TRIGGER_DEADBAND ? r2 : 0;
  return (up - down) * fullDps;
}

/** A rate clamped to the agent's limit and quantised to the send step. */
function quantise(dps: number): number {
  const q = Math.round(dps / GIMBAL_RATE_STEP_DPS) * GIMBAL_RATE_STEP_DPS;
  return Math.max(-MAX_DPS, Math.min(MAX_DPS, q)) || 0;
}

/**
 * Drives one drone's gimbal rate on its agent, from the controller's
 * triggers (`tick`) or the on-screen pad (`set`). One request is in flight
 * at a time and the latest wanted rate wins, so a zero sent on release can
 * never be overtaken by an older non-zero rate. Rates are quantised, a change
 * goes out at most every 100 ms, a held non-zero rate is renewed every half
 * hold, a 429 backs off and retries, and a 404 or 501 (no route, or a flight
 * controller that cannot rate-drive a gimbal) stops it for the session.
 */
export class GimbalRateDriver {
  private wantP = 0;
  private wantY = 0;
  private sentP = 0;
  private sentY = 0;
  private sentAt = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private backoffUntil = 0;
  private unsupported = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly droneId: string,
    private readonly fullDps: number,
    private readonly send: GimbalRateSend = postGimbalRate,
    private readonly clock: () => number = Date.now,
  ) {}

  /** The triggers' values this tick (each 0..1). */
  tick(l2: number, r2: number): void {
    this.set(triggerPitchDps(l2, r2, this.fullDps), 0);
  }

  /** Want this pitch and yaw rate (°/s); zero both to stop. */
  set(pitchDps: number, yawDps: number): void {
    this.wantP = quantise(pitchDps);
    this.wantY = quantise(yawDps);
    this.pump();
  }

  /** Stop the gimbal if it is moving (the cockpit closed or the pad dropped). */
  stop(): void {
    this.set(0, 0);
  }

  private schedule(at: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(0, at - this.clock()));
  }

  private pump(): void {
    if (this.unsupported || this.inFlight) return;
    const now = this.clock();
    const moving = this.wantP !== 0 || this.wantY !== 0;
    const changed = this.wantP !== this.sentP || this.wantY !== this.sentY;
    if (!changed && !moving) return;
    if (now < this.backoffUntil) return this.schedule(this.backoffUntil);
    // A stop goes out at once; a change waits out the minimum interval and a
    // held rate is renewed every half hold.
    const stopping = !moving;
    const due = changed
      ? stopping
        ? now
        : this.sentAt + GIMBAL_RATE_MIN_INTERVAL_MS
      : this.sentAt + GIMBAL_RATE_HOLD_MS / 2;
    if (now < due) return this.schedule(due);
    const p = this.wantP;
    const y = this.wantY;
    this.inFlight = true;
    this.sentAt = now;
    void this.send(this.droneId, p, y).then((status) => {
      this.inFlight = false;
      if (status === 404 || status === 501) {
        this.unsupported = true;
        return;
      }
      if (status === 429) {
        this.backoffUntil = this.clock() + GIMBAL_RATE_BACKOFF_MS;
      } else {
        this.sentP = p;
        this.sentY = y;
      }
      this.pump();
    });
  }
}
