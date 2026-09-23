import type { ParamMetadata } from "@/lib/protocol/param-metadata";

/**
 * Names treated as read-only when the metadata does not say. ArduPilot marks
 * its STAT_* counters ReadOnly in the parameter docs; the pattern covers a
 * grid opened before metadata loaded.
 */
const READ_ONLY_PATTERNS = [/^STAT_/, /^INS_\w+_ID$/, /^GND_\w+_ID$/];

/**
 * Parameters the docs mark ReadOnly that still accept a write. STAT_RESET
 * resets the flight statistics when set to 0 (AP_Stats), so the grid must
 * let the operator write it.
 */
const WRITABLE_DESPITE_READONLY: Record<string, true> = { STAT_RESET: true };

export function isReadOnly(name: string, meta: ParamMetadata | undefined): boolean {
  if (Object.hasOwn(WRITABLE_DESPITE_READONLY, name)) return false;
  if (meta?.readOnly) return true;
  return READ_ONLY_PATTERNS.some((p) => p.test(name));
}

/** Dangerous value validation rules for specific parameter patterns. */
interface DangerousRule {
  test: (name: string) => boolean;
  check: (value: number) => boolean;
  message: string;
}

const DANGEROUS_VALUE_RULES: DangerousRule[] = [
  { test: (n) => n === "BATT_CAPACITY", check: (v) => v < 0, message: "Battery capacity cannot be negative" },
  { test: (n) => n === "MOT_SPIN_ARM", check: (v) => v === 0, message: "Zero spin arm may prevent motor start" },
  { test: (n) => n.startsWith("FS_") && n.endsWith("_TIMEOUT"), check: (v) => v < 0, message: "Failsafe timeout cannot be negative" },
  { test: (n) => n === "FENCE_ALT_MAX", check: (v) => v < 0, message: "Fence max altitude cannot be negative" },
  { test: (n) => n === "FENCE_RADIUS", check: (v) => v < 0, message: "Fence radius cannot be negative" },
  { test: (n) => n === "BATT_LOW_VOLT", check: (v) => v < 0, message: "Low battery voltage cannot be negative" },
  { test: (n) => n === "BATT_CRT_VOLT", check: (v) => v < 0, message: "Critical battery voltage cannot be negative" },
];

export function getDangerousWarning(name: string, value: number): string | null {
  for (const rule of DANGEROUS_VALUE_RULES) {
    if (rule.test(name) && rule.check(value)) return rule.message;
  }
  return null;
}

/** Check if a value is outside the parameter's defined range. */
export function isValueOutOfRange(value: number, meta: ParamMetadata | undefined): boolean {
  if (!meta?.range) return false;
  return value < meta.range.min || value > meta.range.max;
}

/**
 * Filter the grid's rows by a search term, matching each param's haystack
 * from {@link buildSearchHaystack} (or its bare name when it has no metadata),
 * case-insensitively.
 */
export function filterBySearch<P extends { name: string }>(
  params: P[],
  haystack: Map<string, string>,
  term: string,
): P[] {
  const lower = term.toLowerCase();
  return params.filter((p) => (haystack.get(p.name) ?? p.name.toLowerCase()).includes(lower));
}

/**
 * Build a per-param lowercased search haystack (name + humanName + description
 * + all enum/bitmask labels), so the grid filter is a single `.includes` per
 * keystroke instead of re-walking every param's option Maps.
 */
export function buildSearchHaystack(
  meta: Map<string, ParamMetadata> | undefined,
  names: string[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of names) {
    const m = meta?.get(name);
    const parts = [name];
    if (m) {
      if (m.humanName) parts.push(m.humanName);
      if (m.description) parts.push(m.description);
      if (m.values) for (const l of m.values.values()) parts.push(l);
      if (m.bitmask) for (const l of m.bitmask.values()) parts.push(l);
    }
    out.set(name, parts.join(" ").toLowerCase());
  }
  return out;
}
