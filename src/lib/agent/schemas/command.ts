/**
 * @module AgentSchemas/Command
 * @description zod schema for the generic command-result envelope the agent
 * returns on POST endpoints.
 *
 * @license GPL-3.0-only
 */

import { z } from "zod";

export const CommandResultSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .passthrough();

/** `POST /api/services/{name}/restart` body (ados-control
 * `routes/service_control.rs` restart_service_result). Every outcome is an
 * HTTP 200; the verdict is `status`. */
export const ServiceRestartResultSchema = z
  .object({
    status: z.enum(["ok", "error"]),
    message: z.string(),
    unit: z.string().optional(),
    aliased_from: z.string().nullable().optional(),
  })
  .passthrough();

/** `POST /api/v1/system/restart-supervisor` body (ados-control
 * `routes/service_control.rs` restart_supervisor). */
export const SupervisorRestartResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
  })
  .passthrough();
