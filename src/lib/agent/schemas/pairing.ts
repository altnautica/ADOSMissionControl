/**
 * @module AgentSchemas/Pairing
 * @description zod schemas for pairing-related agent responses.
 *
 * @license GPL-3.0-only
 */

import { z } from "zod";

import { NullableNumber } from "./primitives";

/**
 * `GET /api/pairing/info`. The agent emits every field even when it has no
 * value: `pairing_code` is null while paired, `owner_id` and `paired_at` are
 * null while unpaired.
 */
export const PairingInfoSchema = z
  .object({
    device_id: z.string(),
    name: z.string(),
    version: z.string(),
    board: z.string(),
    paired: z.boolean(),
    pairing_code: z.string().nullish(),
    owner_id: z.string().nullish(),
    paired_at: NullableNumber.optional(),
    mdns_host: z.string(),
  })
  .passthrough();

export const ClaimResponseSchema = z
  .object({
    api_key: z.string(),
    device_id: z.string(),
    name: z.string(),
    mdns_host: z.string(),
  })
  .passthrough();
