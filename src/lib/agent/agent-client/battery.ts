/**
 * @module agent/agent-client/battery
 * @description Reader for the agent's battery-health route: per-pack cell
 * health, time-to-reserve prediction and anomaly state.
 * @license GPL-3.0-only
 */

import { BatteryHealthSchema, type BatteryHealth } from "../schemas/battery";
import { agentRequest, type RequestContext } from "./transport";

export function getBatteryHealth(ctx: RequestContext): Promise<BatteryHealth> {
  return agentRequest<BatteryHealth>(ctx, "/api/v1/battery", {
    schema: BatteryHealthSchema,
    allowSchemaFallback: true,
  });
}
