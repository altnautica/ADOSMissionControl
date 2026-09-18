/**
 * @module AgentSchemas/Primitives
 * @description Shared zod helpers reused across every per-domain schema.
 * Not re-exported from the public barrel; callers import from the
 * domain-specific files (heartbeat, capabilities, etc.).
 *
 * @license GPL-3.0-only
 */

import { z } from "zod";

/**
 * Numeric coercion for fields an older agent shipped as a string but which are
 * ALWAYS present on the wire.
 *
 * Falls back to 0 on parse failure. Use this ONLY where 0 is a real reading —
 * never for a field the agent may omit, because Zod's object parser invokes
 * every non-optional shape entry with `input[key]` even when the key is
 * absent, so an omitted field parses clean as `0` with no schema issue and the
 * schema-fallback path never engages. That turned an unreported peer battery
 * into a red 0% and an unreported signal into a 0 dBm "perfect link".
 * {@link OptionalNumberLike} is the form for anything that can be absent.
 */
export const NumberLike = z.preprocess(
  (val) => {
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  },
  z.number(),
);

/**
 * Same string tolerance as {@link NumberLike}, but an absent or unparseable
 * value yields `undefined` rather than a fabricated 0, so a surface renders
 * the no-data glyph instead of a plausible measurement.
 */
export const OptionalNumberLike = z.preprocess(
  (val) => {
    if (typeof val === "number") return Number.isFinite(val) ? val : undefined;
    if (typeof val === "string") {
      const n = Number(val);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  },
  z.number().optional(),
);

export const NullableNumber = z.union([z.number(), z.null()]).nullable();
export const NullableString = z.union([z.string(), z.null()]).nullable();
