/**
 * @module manifest-values
 * @description Scalar readers shared by the manifest parsers. Each accepts
 * the loosely typed value a YAML document yields and returns the typed value,
 * or undefined when the input does not carry one.
 *
 * @license GPL-3.0-only
 */

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    const s = str(item);
    if (s !== undefined && s !== "") out.push(s);
  }
  return out.length > 0 ? out : undefined;
}
