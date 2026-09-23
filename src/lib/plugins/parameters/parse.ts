/**
 * @module plugins/parameters/parse
 * @description Parse the `gcs.contributes.parameters[]` block of a plugin
 * manifest into validated `PluginParameter` rows. Forward-compatible: an entry
 * with a malformed schema, an unknown binding, or a missing key is dropped
 * with a console warning, never throws — matching the parse-drop discipline of
 * `manifest-parse.ts`.
 *
 * @license GPL-3.0-only
 */

import {
  type PluginParameter,
  type ParameterSchema,
  type ParameterUi,
  type ParameterBinding,
  type ParameterWidget,
  validateParameterSchema,
  PARAMETER_WIDGETS,
  PARAMETER_BINDINGS,
} from "./schema";

/** A parsed, validated parameter contribution. Structurally a
 * `PluginParameter`; named distinctly to mirror `ParsedSkillContribution` /
 * `ParsedSlotContribution`. */
export type ParsedParameterContribution = PluginParameter;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function warn(message: string): void {
  if (typeof console !== "undefined") console.warn(message);
}

/** Narrow a raw object to a `ParameterSchema`, copying only known keywords. */
function readSchema(raw: unknown): ParameterSchema | null {
  if (!isObject(raw)) return null;
  const type = str(raw.type);
  if (
    type !== "number" &&
    type !== "integer" &&
    type !== "boolean" &&
    type !== "string"
  ) {
    return null;
  }
  const schema: ParameterSchema = { type };
  const minimum = num(raw.minimum);
  const maximum = num(raw.maximum);
  const step = num(raw.step);
  if (minimum !== undefined) schema.minimum = minimum;
  if (maximum !== undefined) schema.maximum = maximum;
  if (step !== undefined) schema.step = step;
  if (Array.isArray(raw.enum)) {
    const vals: Array<string | number | boolean> = [];
    for (const e of raw.enum) {
      if (
        typeof e === "string" ||
        typeof e === "number" ||
        typeof e === "boolean"
      ) {
        vals.push(e);
      }
    }
    if (vals.length > 0) schema.enum = vals;
  }
  const pattern = str(raw.pattern);
  if (pattern !== undefined) schema.pattern = pattern;
  if (
    typeof raw.default === "string" ||
    typeof raw.default === "number" ||
    typeof raw.default === "boolean"
  ) {
    schema.default = raw.default;
  }
  return schema;
}

function readUi(raw: unknown): ParameterUi | undefined {
  if (!isObject(raw)) return undefined;
  const ui: ParameterUi = {};
  const widget = str(raw.widget);
  if (widget !== undefined && PARAMETER_WIDGETS.has(widget)) {
    ui.widget = widget as ParameterWidget;
  }
  const label = str(raw.label);
  if (label !== undefined) ui.label = label;
  const group = str(raw.group);
  if (group !== undefined) ui.group = group;
  const help = str(raw.help);
  if (help !== undefined) ui.help = help;
  const task = str(raw.task);
  if (task !== undefined) ui.task = task;
  const order = num(raw.order);
  if (order !== undefined) ui.order = order;
  if (isObject(raw.visible_if)) {
    const key = str(raw.visible_if.key);
    const eq = raw.visible_if.equals;
    if (
      key !== undefined &&
      (typeof eq === "string" ||
        typeof eq === "number" ||
        typeof eq === "boolean")
    ) {
      ui.visible_if = { key, equals: eq };
    }
  }
  if (Array.isArray(raw.bits)) {
    // Bitmask labels: `{ bit: non-negative integer, label: string }`, first
    // entry wins for a repeated bit.
    const bits: { bit: number; label: string }[] = [];
    const seenBits = new Set<number>();
    for (const entry of raw.bits) {
      if (!isObject(entry)) continue;
      const bit = num(entry.bit);
      const bitLabel = str(entry.label);
      if (bit === undefined || !Number.isInteger(bit) || bit < 0 || bitLabel === undefined) {
        continue;
      }
      if (seenBits.has(bit)) continue;
      seenBits.add(bit);
      bits.push({ bit, label: bitLabel });
    }
    if (bits.length > 0) ui.bits = bits;
  }
  return Object.keys(ui).length > 0 ? ui : undefined;
}

/**
 * Parse `gcs.contributes.parameters[]`. Each entry must have a string `key`
 * and a well-formed `schema`; an unknown `binding` is coerced to the default
 * (`plugin.config`) with a warning. Invalid entries are dropped + warned.
 * Returns undefined when no valid entry is found.
 */
export function parseParameterContributions(
  v: unknown,
): ParsedParameterContribution[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ParsedParameterContribution[] = [];
  const seen = new Set<string>();
  for (const entry of v) {
    if (!isObject(entry)) continue;
    const key = str(entry.key);
    if (!key) {
      warn("Plugin parameter dropped: missing string `key`");
      continue;
    }
    if (seen.has(key)) {
      warn(`Plugin parameter "${key}" dropped: duplicate key`);
      continue;
    }
    const schema = readSchema(entry.schema);
    if (!schema) {
      warn(`Plugin parameter "${key}" dropped: missing or invalid schema`);
      continue;
    }
    const schemaCheck = validateParameterSchema(schema);
    if (!schemaCheck.ok) {
      warn(`Plugin parameter "${key}" dropped: ${schemaCheck.error}`);
      continue;
    }
    let binding: ParameterBinding = "plugin.config";
    const rawBinding = str(entry.binding);
    if (rawBinding !== undefined) {
      if (PARAMETER_BINDINGS.has(rawBinding)) {
        binding = rawBinding as ParameterBinding;
      } else {
        warn(
          `Plugin parameter "${key}": unknown binding "${rawBinding}", defaulting to plugin.config`,
        );
      }
    }
    const row: ParsedParameterContribution = { key, schema, binding };
    const ui = readUi(entry.ui);
    if (ui) row.ui = ui;
    seen.add(key);
    out.push(row);
  }
  return out.length > 0 ? out : undefined;
}
