/**
 * @module input/ds4-bindings
 * @description The controller binding table and gesture engine, from the
 * shared cockpit spec `ds4.json`. A binding is a control, the controls held
 * with it, a gesture (tap, hold, double-tap or analog), an optional `when`
 * condition and the action it fires.
 *
 * The engine is pure: the caller feeds it which controls are down at each
 * poll and a clock, and it calls back with the binding to fire. Rules:
 *
 *   - the most specific binding wins: while L1 and R1 are held the L1 + R1
 *     arm hold applies, not L1's own tap, and R1's own tap is suppressed
 *     because R1 is held as part of the combo;
 *   - a tap fires on release, unless a double-tap binding for the same
 *     control is live, in which case it waits `double_tap_ms` for a second
 *     tap;
 *   - a hold fires once, when held for its `hold_ms`; a release before that
 *     is a tap; `stick_l_centered` must hold for the whole hold;
 *   - a `press` row fires on button-down; a hold row on the same control
 *     keeps timing and fires on top (PS: brake on press, return home at
 *     2 s). A Pause `tap` row is treated the same way, so a brake never
 *     waits for the release;
 *   - several rows for one gesture (Triangle hold: take off on the ground,
 *     land in the air) fire the first whose `when` is true.
 *
 * @license GPL-3.0-only
 */

import ds4 from "@/lib/cockpit-spec/ds4.json";
import layoutSpec from "@/lib/cockpit-spec/layout.json";

export type Ds4Gesture = "press" | "tap" | "hold" | "double_tap" | "analog";

export interface Ds4Binding {
  control: string;
  with: string[];
  gesture: Ds4Gesture;
  hold_ms: number | null;
  when: string | null;
  action: string;
  rumble: string | null;
  locked: boolean;
  rate_full_dps?: number;
}

export interface Ds4ActionDef {
  id: string;
  label: string;
  group: string;
  builtin?: string;
}

export const SPEC_BINDINGS: readonly Ds4Binding[] = ds4.bindings as Ds4Binding[];
export const DS4_ACTIONS: readonly Ds4ActionDef[] = ds4.actions as Ds4ActionDef[];
export const DS4_CONTROLS: readonly string[] = ds4.controls;
export const LOCKED_ACTIONS = ds4.locked_actions as readonly { action: string; gesture: Ds4Gesture; combo: boolean }[];
export const DOUBLE_TAP_MS: number = ds4.double_tap_ms;
export const CENTERED_THRESHOLD: number = ds4.centered_threshold;
/** Standard-mapping Web Gamepad button index per control. */
export const WEB_BUTTON_INDEX = ds4.platform_map.web_standard.buttons as Record<string, number>;
export const TRIGGER_PRESSED = ds4.stream.trigger_pressed_threshold;

/** The emergency stop's hold (`layout.json` `holds_ms.stop`). */
export const STOP_HOLD_MS: number = layoutSpec.holds_ms.stop;
const STOP_ACTION = "kill";
const raisedStopRows = new Set<string>();

/**
 * A row bound to the emergency stop runs as a hold of at least the stop hold:
 * a press, tap or double tap becomes that hold, a shorter hold is raised to
 * it. Applied in the engine at run time and in the editor and import paths.
 */
export function stopHoldRow(b: Ds4Binding): Ds4Binding {
  if (b.action !== STOP_ACTION || b.gesture === "analog") return b;
  if (b.gesture === "hold" && (b.hold_ms ?? 0) >= STOP_HOLD_MS) return b;
  const key = `${[...b.with, b.control].join("+")}:${b.gesture}:${b.hold_ms}`;
  if (!raisedStopRows.has(key)) {
    raisedStopRows.add(key);
    console.info(`[controls] emergency stop on ${key} raised to a ${STOP_HOLD_MS} ms hold`);
  }
  return { ...b, gesture: "hold", hold_ms: STOP_HOLD_MS };
}

/** Spec label for an action id; a `skill:<plugin>:<skill>` id shows the skill id. */
export function actionLabel(id: string): string {
  const def = DS4_ACTIONS.find((a) => a.id === id);
  if (def) return def.label;
  if (id.startsWith("skill:")) return id.split(":").slice(2).join(":") || id;
  return id;
}

/** The conflict key: one control + its held controls + gesture + `when`. */
function chordKey(b: Ds4Binding): string {
  return `${b.control}+${[...b.with].sort().join("+")}|${b.gesture}`;
}

/**
 * Bindings bound twice: same control, held controls and gesture, with `when`
 * conditions that can both be true (a null `when` overlaps every other).
 * Returns the indexes of every binding in a conflict.
 */
export function bindingConflicts(bindings: readonly Ds4Binding[]): Set<number> {
  const out = new Set<number>();
  const exclusive = (a: string | null, b: string | null): boolean => {
    if (a === null || b === null) return false;
    const pairs = [
      ["picker_open", "picker_closed"],
      ["on_ground", "airborne"],
      ["rth_active", "not_rth"],
    ];
    return pairs.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
  };
  for (let i = 0; i < bindings.length; i++) {
    if (bindings[i].action === "none") continue;
    for (let j = i + 1; j < bindings.length; j++) {
      if (bindings[j].action === "none") continue;
      if (chordKey(bindings[i]) !== chordKey(bindings[j])) continue;
      if (exclusive(bindings[i].when, bindings[j].when)) continue;
      out.add(i);
      out.add(j);
    }
  }
  return out;
}

/** Locked actions a binding list is missing (a file without them is refused). */
export function missingLocked(bindings: readonly Ds4Binding[]): string[] {
  return LOCKED_ACTIONS.filter(
    (l) =>
      !bindings.some(
        (b) => b.action === l.action && b.gesture === l.gesture && (b.with.length > 0) === l.combo,
      ),
  ).map((l) => `${l.action} (${l.gesture})`);
}

interface Press {
  /** When the control went down. */
  t0: number;
  /** The bindings this press can fire, most specific first. */
  candidates: Ds4Binding[];
  holdFired: boolean;
  /** A brake tap already fired on press. */
  tapFired: boolean;
  /** A `stick_l_centered` hold broke the condition during this press. */
  broken: boolean;
}

export interface GestureCallbacks {
  /** Evaluate a `when` condition now. */
  when: (cond: string) => boolean;
  fire: (b: Ds4Binding) => void;
  /** A hold is in progress (0..1) for the binding, or ended (null). */
  holdProgress?: (b: Ds4Binding, progress: number | null) => void;
}

export class GestureEngine {
  private bindings: readonly Ds4Binding[];
  private readonly cb: GestureCallbacks;
  private down = new Set<string>();
  private presses = new Map<string, Press>();
  /** Controls held as part of another control's combo: their own bindings are muted. */
  private muted = new Set<string>();
  /** A tap waiting for a possible second tap: control → (binding group, deadline). */
  private pendingTap = new Map<string, { candidates: Ds4Binding[]; until: number }>();

  constructor(bindings: readonly Ds4Binding[], cb: GestureCallbacks) {
    this.bindings = bindings.filter((b) => b.gesture !== "analog" && b.action !== "none").map(stopHoldRow);
    this.cb = cb;
  }

  setBindings(bindings: readonly Ds4Binding[]): void {
    this.bindings = bindings.filter((b) => b.gesture !== "analog" && b.action !== "none").map(stopHoldRow);
    this.presses.clear();
    this.pendingTap.clear();
    this.muted.clear();
  }

  /**
   * Forget every press without firing anything: the surface can no longer
   * see the pad (tab hidden, pad lost), so a release it never observed must
   * not complete a hold or count as a tap. A control still down later reads
   * as a fresh press.
   */
  reset(): void {
    for (const p of this.presses.values()) {
      for (const b of p.candidates) if (b.gesture === "hold") this.cb.holdProgress?.(b, null);
    }
    this.presses.clear();
    this.pendingTap.clear();
    this.muted.clear();
    this.down = new Set();
  }

  private candidatesFor(control: string, held: Set<string>): Ds4Binding[] {
    const rows = this.bindings.filter((b) => b.control === control && b.with.every((w) => held.has(w)));
    if (rows.length === 0) return rows;
    const best = Math.max(...rows.map((b) => b.with.length));
    return rows.filter((b) => b.with.length === best);
  }

  private firstWhen(rows: Ds4Binding[]): Ds4Binding | null {
    return rows.find((b) => b.when === null || this.cb.when(b.when)) ?? null;
  }

  /**
   * A held control of a combo was let go: the combo is aborted. Every press
   * still waiting on a binding that needs `control` is dropped, its hold
   * progress ended, so the control left down neither completes the combo's
   * hold nor fires its own binding until it is pressed again.
   */
  private breakChordsNeeding(control: string): void {
    for (const [c, p] of this.presses) {
      if (p.holdFired || !p.candidates.some((b) => b.with.includes(control))) continue;
      for (const b of p.candidates) if (b.gesture === "hold") this.cb.holdProgress?.(b, null);
      this.presses.delete(c);
    }
  }

  /** Feed the controls down now. */
  update(isDown: (control: string) => boolean, now: number): void {
    const next = new Set<string>();
    for (const c of DS4_CONTROLS) if (isDown(c)) next.add(c);

    // Releases first.
    for (const c of this.down) {
      if (next.has(c)) continue;
      const p = this.presses.get(c);
      this.presses.delete(c);
      if (this.muted.delete(c)) {
        this.breakChordsNeeding(c);
        continue;
      }
      if (!p) continue;
      for (const b of p.candidates) if (b.gesture === "hold") this.cb.holdProgress?.(b, null);
      if (p.holdFired || p.tapFired) continue;
      const taps = p.candidates.filter((b) => b.gesture === "tap");
      const doubles = p.candidates.filter((b) => b.gesture === "double_tap" && (b.when === null || this.cb.when(b.when)));
      const waiting = this.pendingTap.get(c);
      if (waiting && now <= waiting.until && doubles.length > 0) {
        this.pendingTap.delete(c);
        const b = this.firstWhen(doubles);
        if (b) this.cb.fire(b);
        continue;
      }
      if (doubles.length > 0) {
        this.pendingTap.set(c, { candidates: taps, until: now + DOUBLE_TAP_MS });
        continue;
      }
      const b = this.firstWhen(taps);
      if (b) this.cb.fire(b);
    }

    // New presses, and presses whose held set grew into a more specific combo.
    for (const c of next) {
      if (this.muted.has(c)) continue;
      const fresh = !this.down.has(c);
      const p = this.presses.get(c);
      const candidates = this.candidatesFor(c, next);
      if (fresh) {
        const brake = this.firstWhen(
          candidates.filter((b) => b.gesture === "press" || (b.gesture === "tap" && b.action === "pause")),
        );
        this.presses.set(c, { t0: now, candidates, holdFired: false, tapFired: brake !== null, broken: false });
        this.pendingTap.delete(c);
        if (brake) this.cb.fire(brake);
      } else if (p && !p.holdFired && candidates.length > 0 && candidates[0].with.length > (p.candidates[0]?.with.length ?? 0)) {
        // A modifier joined: the combo replaces the plain binding; restart its timer.
        this.presses.set(c, { t0: now, candidates, holdFired: false, tapFired: false, broken: false });
      }
      const cur = this.presses.get(c);
      if (cur) for (const w of cur.candidates[0]?.with ?? []) {
        this.muted.add(w);
        this.presses.delete(w);
        this.pendingTap.delete(w);
      }
    }

    // Holds.
    for (const [c, p] of this.presses) {
      if (p.holdFired || this.muted.has(c)) continue;
      const holds = p.candidates.filter((b) => b.gesture === "hold");
      for (const b of holds) {
        if (b.when === "stick_l_centered" && !this.cb.when("stick_l_centered")) p.broken = true;
        const ms = b.hold_ms ?? 1500;
        const prog = Math.min(1, (now - p.t0) / ms);
        if (!p.broken) this.cb.holdProgress?.(b, prog);
      }
      if (p.broken) continue;
      const due = holds.filter((b) => now - p.t0 >= (b.hold_ms ?? 1500));
      if (due.length === 0) continue;
      const b = due.find((h) => h.when === null || h.when === "stick_l_centered" || this.cb.when(h.when)) ?? null;
      if (b) {
        p.holdFired = true;
        this.cb.holdProgress?.(b, null);
        this.cb.fire(b);
      }
    }

    // Single taps whose double-tap window closed.
    for (const [c, w] of this.pendingTap) {
      if (now <= w.until || next.has(c)) continue;
      this.pendingTap.delete(c);
      const b = this.firstWhen(w.candidates);
      if (b) this.cb.fire(b);
    }

    this.down = next;
  }
}
