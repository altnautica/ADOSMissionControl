/**
 * @module hud/pilot-feedback
 * @description The controller rumble a pilot-state change earns, from the
 * cockpit spec's rule table (`ds4.json` `feedback`): the strongest class
 * (`critical`, `warning`, `mode_change`) with a rule that fires between two
 * consecutive pilot states. The states are the raw snake_case `pilot` kind;
 * null for `next` is a pilot state gone stale (the surface's own timer), null
 * for `prev` a first state, which earns nothing. The ground station's
 * controller runs the same table.
 *
 * Pure: imports only the spec. Mission Control copies this file byte for byte.
 *
 * @license GPL-3.0-only
 */

import ds4 from "../cockpit-spec/ds4.json";

export type FeedbackClass = "critical" | "warning" | "mode_change";

type Trigger = "changed" | "new_value" | "entered" | "appeared" | "replaced" | "new_item" | "state_lost";

interface FeedbackRule {
  id: string;
  field?: string;
  on: Trigger;
  values?: unknown[];
  where?: Record<string, unknown>;
  key?: string;
  keys?: string[];
  armed_only?: boolean;
  rumble: string;
}

const FEEDBACK = ds4.feedback as unknown as { order: FeedbackClass[] } & Record<FeedbackClass, FeedbackRule[]>;

/** The value at a dotted path; a missing step reads as null. */
function at(state: unknown, path: string): unknown {
  let v: unknown = state;
  for (const k of path.split(".")) {
    v = typeof v === "object" && v !== null && !Array.isArray(v) ? ((v as Record<string, unknown>)[k] ?? null) : null;
  }
  return v ?? null;
}

/** JSON equality: the wire values are plain JSON. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The `key` values of the items of an array that match every `where` pair. */
function matchingKeys(rule: FeedbackRule, items: unknown): unknown[] {
  if (!Array.isArray(items)) return [];
  const key = rule.key ?? "id";
  return items
    .filter((it) => Object.entries(rule.where ?? {}).every(([k, v]) => same(at(it, k), v)))
    .map((it) => at(it, key));
}

function fires(rule: FeedbackRule, prev: unknown | null, next: unknown | null): boolean {
  if (rule.on === "state_lost") return prev !== null && next === null;
  if (prev === null || next === null) return false;
  if (rule.armed_only && at(next, "armed") === false) return false;
  const a = at(prev, rule.field ?? "");
  const b = at(next, rule.field ?? "");
  switch (rule.on) {
    case "changed":
      return !same(a, b);
    case "new_value":
      return b !== null && !same(a, b);
    case "entered":
      return !same(a, b) && (rule.values ?? []).some((v) => same(v, b));
    case "appeared":
      return a === null && b !== null;
    case "replaced":
      return a !== null && b !== null && (rule.keys ?? [""]).some((k) => !same(k ? at(a, k) : a, k ? at(b, k) : b));
    case "new_item": {
      const before = matchingKeys(rule, a);
      return matchingKeys(rule, b).some((k) => !before.some((p) => same(p, k)));
    }
    default:
      return false;
  }
}

/** The rumble class a change from `prev` to `next` earns, or null. */
export function feedbackAlert(prev: unknown | null, next: unknown | null): FeedbackClass | null {
  return FEEDBACK.order.find((cls) => FEEDBACK[cls].some((r) => fires(r, prev, next))) ?? null;
}
