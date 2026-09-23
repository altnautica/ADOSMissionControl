/**
 * @module plugins/parameters/ajv-validator
 * @description The `ajv`-backed (JSON Schema Draft-07) value validator shared by
 * the parameter pipeline — one of the three shared validator surfaces: the
 * GCS manifest parse, the GCS form commit, and (mirrored in Rust) the agent
 * config writer. A single shared `Ajv` instance compiles each distinct
 * parameter schema once (memoised by the schema's JSON form, since callers
 * rebuild schema objects freely and ajv caches by object identity) and
 * validates a committed value against it, so a richer
 * schema (beyond the scalar subset) validates correctly without a hand-rolled
 * codepath per keyword.
 *
 * Two subset semantics are preserved so behaviour is identical to the prior
 * hand-rolled validator: the UI-only `step` (a quantization hint applied by
 * `clampValue`, not a validation constraint) is dropped before validating, and
 * an `enum` constrains membership ALONE (the subset allowed a mixed-type enum),
 * so the JSON-Schema form of an enum schema is `{ enum: [...] }` with no `type`.
 *
 * @license GPL-3.0-only
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

import type { ParameterSchema, ValidationResult } from "./schema";

// Non-coercing, lenient on unknown keywords (forward-compatible), no
// default application (the form/agent layer owns defaults).
const ajv = new Ajv({
  allErrors: false,
  strict: false,
  coerceTypes: false,
  useDefaults: false,
});

/**
 * The Draft-07 validation schema for a parameter: the parameter schema with the
 * UI-only `step` dropped, and an enum reduced to membership-only (`{ enum }`),
 * matching the subset's enum-short-circuit semantics.
 */
export function toJsonSchema(schema: ParameterSchema): Record<string, unknown> {
  if (schema.enum) {
    return { enum: [...schema.enum] };
  }
  const { step: _step, ...rest } = schema;
  return rest as Record<string, unknown>;
}

/** Format the first ajv error into the friendly, value-relative message style
 * the form surfaces ("must be >= 2", "is not one of the allowed values"). */
function friendly(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "is invalid";
  if (errors[0].keyword === "enum") return "is not one of the allowed values";
  // ajv prefixes "data " for a root value; strip it so the message reads as a
  // property of the value the form is validating.
  return ajv.errorsText(errors).replace(/^data\s*/, "").trim() || "is invalid";
}

/**
 * Compiled validators keyed by the JSON form of the validation schema. ajv
 * caches by object identity and never evicts, so compiling a freshly built
 * schema object per call would generate and retain a new validator every
 * time; this cache compiles each distinct schema once. A schema that does not
 * compile is cached as `null`.
 */
const compiled = new Map<string, ValidateFunction | null>();

function compiledFor(schema: ParameterSchema): ValidateFunction | null {
  const jsonSchema = toJsonSchema(schema);
  const key = JSON.stringify(jsonSchema);
  const hit = compiled.get(key);
  if (hit !== undefined) return hit;
  let fn: ValidateFunction | null;
  try {
    fn = ajv.compile(jsonSchema);
  } catch {
    fn = null;
  }
  compiled.set(key, fn);
  return fn;
}

/**
 * Validate a committed value against a (well-formed) parameter schema via ajv.
 * Returns the same `{ ok, error? }` shape the form + parser already consume.
 */
export function validateValueAjv(
  schema: ParameterSchema,
  value: unknown,
): ValidationResult {
  const validate = compiledFor(schema);
  if (!validate) return { ok: false, error: "has an invalid schema" };
  return validate(value) === true
    ? { ok: true }
    : { ok: false, error: friendly(validate.errors) };
}

/** Whether the parameter schema compiles as a Draft-07 schema (structural
 * well-formedness — the parse gate's ajv check, complementing the domain rules
 * JSON Schema can't express such as `minimum <= maximum`). */
export function schemaCompiles(schema: ParameterSchema): boolean {
  return compiledFor(schema) !== null;
}
