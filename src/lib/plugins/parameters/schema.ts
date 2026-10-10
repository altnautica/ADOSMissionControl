/**
 * @module plugins/parameters/schema
 * @description The plugin-parameter contract: a JSON-Schema (Draft-07) data
 * contract plus a thin `ui` presentation layer, plus the validator shared by
 * three call sites — the GCS manifest parse, the GCS form (clamp/validate on
 * commit), and (mirrored in Rust) the agent config writer.
 *
 * Value validation is `ajv`-backed (see `./ajv-validator`): the parameter
 * schema is a real Draft-07 schema, so a richer schema validates correctly
 * without a hand-rolled codepath per keyword. This module keeps the structural
 * + domain checks the parse gate needs (the supported scalar `type` set,
 * `minimum <= maximum`, `step > 0`, non-empty `enum`, valid `pattern`) that
 * plain JSON Schema cannot express, plus `clampValue` (ajv does not quantize)
 * and the `ui`/binding/default helpers. The supported subset is number /
 * integer / boolean / string / enum, with `minimum`/`maximum`/`step` (a UI-only
 * quantization hint), `pattern`, and `default`.
 *
 * @license GPL-3.0-only
 */

import { schemaCompiles, validateValueAjv } from "./ajv-validator";

/** The JSON-Schema scalar types the parameter subset supports. */
export type ParameterSchemaType =
  | "number"
  | "integer"
  | "boolean"
  | "string";

/**
 * A JSON-Schema Draft-07 subset describing one parameter's value. Only the
 * keywords a drone-plugin parameter needs are honored; unknown keywords are
 * ignored (forward-compatible), never an error.
 */
export interface ParameterSchema {
  type: ParameterSchemaType;
  /** Numeric inclusive bounds (number/integer only). */
  minimum?: number;
  maximum?: number;
  /** UI/quantization step (number/integer only). Advisory for clamping. */
  step?: number;
  /** Allowed values. When present the value must be one of these
   * (any scalar type); pairs with the `enum` widget. */
  enum?: ReadonlyArray<string | number | boolean>;
  /** Regex source applied to string values. */
  pattern?: string;
  /** Default applied when the stored value is absent. */
  default?: string | number | boolean;
}

/** The control a parameter renders as. Inferred from `schema.type` when the
 * manifest omits it; `range`/`model`/`model_upload` are always explicit. */
export type ParameterWidget =
  | "number"
  | "range"
  | "boolean"
  | "enum"
  | "bitmask"
  | "string"
  | "model"
  | "model_upload"
  | "camera"
  | "group";

/** Where a parameter's committed value is written. Drives the renderer's
 * binding router. `plugin.config` is the default (the per-drone plugin
 * ConfigStore); `engine.detector` writes the shared vision detector;
 * `agent.config` writes a whitelisted system key. */
export type ParameterBinding =
  | "plugin.config"
  | "engine.detector"
  | "agent.config";

/** The presentation layer (the RJSF `uiSchema` split): never affects
 * validation, only how the value is shown and grouped. */
export interface ParameterUi {
  widget?: ParameterWidget;
  /** i18n key or literal label. */
  label?: string;
  /** Section grouping in the rendered panel. */
  group?: string;
  /** Helper/description text. */
  help?: string;
  /** Conditional reveal: show this control only when another parameter's
   * committed value equals `equals`. */
  visible_if?: { key: string; equals: string | number | boolean };
  /** Model-widget filter (the vision task a `model`/`model_upload` picker
   * lists), e.g. "detection" | "reid" | "depth". */
  task?: string;
  /** Sort hint within a group. */
  order?: number;
  /** Bitmask-widget bit table (bit index → label). The value is an integer;
   * these labels are presentation only. */
  bits?: { bit: number; label: string }[];
  /** Camera-widget filter: the roster purpose (e.g. "detect") whose cameras
   * the picker lists first. The stored value is a camera id or "auto". */
  purpose?: string;
}

/** One declared plugin parameter. */
export interface PluginParameter {
  /** Config key written on commit (unique within the plugin). */
  key: string;
  schema: ParameterSchema;
  ui?: ParameterUi;
  /** Defaults to `plugin.config` when absent. */
  binding?: ParameterBinding;
}

export interface ValidationResult {
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  error?: string;
}

const SCHEMA_TYPES: ReadonlySet<string> = new Set([
  "number",
  "integer",
  "boolean",
  "string",
]);

const WIDGETS: ReadonlySet<string> = new Set([
  "number",
  "range",
  "boolean",
  "enum",
  "bitmask",
  "string",
  "model",
  "model_upload",
  "camera",
  "group",
]);

const BINDINGS: ReadonlySet<string> = new Set([
  "plugin.config",
  "engine.detector",
  "agent.config",
]);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate that a `ParameterSchema` is well-formed. A malformed schema is
 * dropped at parse time (never throws); this returns the reason so the parser
 * can log it.
 */
export function validateParameterSchema(schema: unknown): ValidationResult {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return { ok: false, error: "schema must be an object" };
  }
  const s = schema as Record<string, unknown>;
  if (typeof s.type !== "string" || !SCHEMA_TYPES.has(s.type)) {
    return {
      ok: false,
      error: `schema.type must be one of number|integer|boolean|string`,
    };
  }
  if (s.minimum !== undefined && !isFiniteNumber(s.minimum)) {
    return { ok: false, error: "schema.minimum must be a finite number" };
  }
  if (s.maximum !== undefined && !isFiniteNumber(s.maximum)) {
    return { ok: false, error: "schema.maximum must be a finite number" };
  }
  if (
    isFiniteNumber(s.minimum) &&
    isFiniteNumber(s.maximum) &&
    s.minimum > s.maximum
  ) {
    return { ok: false, error: "schema.minimum must be <= schema.maximum" };
  }
  if (s.step !== undefined && (!isFiniteNumber(s.step) || s.step <= 0)) {
    return { ok: false, error: "schema.step must be a positive number" };
  }
  if (s.enum !== undefined) {
    if (!Array.isArray(s.enum) || s.enum.length === 0) {
      return { ok: false, error: "schema.enum must be a non-empty array" };
    }
    for (const e of s.enum) {
      if (
        typeof e !== "string" &&
        typeof e !== "number" &&
        typeof e !== "boolean"
      ) {
        return { ok: false, error: "schema.enum entries must be scalars" };
      }
    }
  }
  if (s.pattern !== undefined) {
    if (typeof s.pattern !== "string") {
      return { ok: false, error: "schema.pattern must be a string" };
    }
    try {
      new RegExp(s.pattern);
    } catch {
      return { ok: false, error: "schema.pattern is not a valid regex" };
    }
  }
  // The schema must also compile as a Draft-07 schema (the ajv parse gate,
  // complementing the domain rules above that JSON Schema cannot express).
  if (!schemaCompiles(s as unknown as ParameterSchema)) {
    return { ok: false, error: "schema is not a valid JSON Schema" };
  }
  if (s.default !== undefined) {
    const dv = validateValue(s as unknown as ParameterSchema, s.default);
    if (!dv.ok) return { ok: false, error: `schema.default ${dv.error}` };
  }
  return { ok: true };
}

/**
 * Validate a committed value against a (already-well-formed) schema. Backed by
 * the shared `ajv` Draft-07 validator ([`validateValueAjv`]); the caller is
 * responsible for having validated the schema. The subset's enum-short-circuit
 * and UI-only-`step` semantics are preserved in `toJsonSchema`, so accept/reject
 * is identical to the prior hand-rolled subset while richer schemas now validate
 * correctly.
 */
export function validateValue(
  schema: ParameterSchema,
  value: unknown,
): ValidationResult {
  return validateValueAjv(schema, value);
}

/**
 * Coerce + clamp a value toward schema-validity for the form commit path:
 * numbers are clamped to `[minimum, maximum]` and quantized to `step`;
 * everything else is returned unchanged (the form rejects truly-invalid
 * values via `validateValue` before calling this). Returns the value to
 * persist.
 */
export function clampValue(
  schema: ParameterSchema,
  value: unknown,
): string | number | boolean | undefined {
  if (schema.type === "number" || schema.type === "integer") {
    if (!isFiniteNumber(value)) return value as undefined;
    let v = value;
    if (isFiniteNumber(schema.minimum)) v = Math.max(v, schema.minimum);
    if (isFiniteNumber(schema.maximum)) v = Math.min(v, schema.maximum);
    if (isFiniteNumber(schema.step) && schema.step > 0) {
      const base = isFiniteNumber(schema.minimum) ? schema.minimum : 0;
      v = base + Math.round((v - base) / schema.step) * schema.step;
      // re-clamp after quantization
      if (isFiniteNumber(schema.minimum)) v = Math.max(v, schema.minimum);
      if (isFiniteNumber(schema.maximum)) v = Math.min(v, schema.maximum);
    }
    if (schema.type === "integer") v = Math.round(v);
    return v;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  return undefined;
}

/** Infer the rendered control from the schema when `ui.widget` is omitted.
 * Explicit widgets (`range`/`model`/`model_upload`) are always set by the
 * manifest; this only fills the obvious defaults. */
export function inferWidget(
  schema: ParameterSchema,
  ui?: ParameterUi,
): ParameterWidget {
  if (ui?.widget && WIDGETS.has(ui.widget)) return ui.widget;
  if (schema.enum && schema.enum.length > 0) return "enum";
  switch (schema.type) {
    case "boolean":
      return "boolean";
    case "number":
    case "integer":
      return "number";
    case "string":
    default:
      return "string";
  }
}

/** Resolve a parameter's effective binding, defaulting to `plugin.config`. */
export function resolveBinding(param: PluginParameter): ParameterBinding {
  return param.binding && BINDINGS.has(param.binding)
    ? param.binding
    : "plugin.config";
}

/** The schema's declared default, or a type-appropriate empty default. */
export function defaultFor(schema: ParameterSchema): string | number | boolean {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case "boolean":
      return false;
    case "number":
    case "integer":
      return isFiniteNumber(schema.minimum) ? schema.minimum : 0;
    case "string":
    default:
      return "";
  }
}

export const PARAMETER_WIDGETS = WIDGETS;
export const PARAMETER_BINDINGS = BINDINGS;
