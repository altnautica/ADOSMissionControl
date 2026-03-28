/**
 * Utilities for parameter value comparisons and display.
 * MAVLink params are frequently REAL32, so tiny float jitter is expected.
 */

export const PARAM_VALUE_EPSILON = 1e-6;

export function areParamValuesEqual(a: number, b: number, epsilon = PARAM_VALUE_EPSILON): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= epsilon * scale;
}

export function formatParamValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value);
  if (areParamValuesEqual(value, rounded)) {
    return String(rounded);
  }
  return parseFloat(value.toFixed(6)).toString();
}

export function getEnumLabel(values: Map<number, string> | undefined, value: number): string | null {
  if (!values || values.size === 0) return null;
  const exact = values.get(value);
  if (exact !== undefined) return exact;

  for (const [key, label] of values) {
    if (areParamValuesEqual(key, value)) return label;
  }
  return null;
}
