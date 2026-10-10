/**
 * Dispatcher-owned cooldown + charge clocks for the Skill Bar. These are
 * out-of-band state: the registry's `getState` is pure and reads only the
 * SkillContext, so a real (wall-clock) cooldown window and a recharging charge
 * budget cannot live there. The dispatcher records them here on a successful
 * one-shot activation; the registry merges a `cooldown` projection + a charge
 * badge over the skill's computed state in `recomputeSelected()`.
 *
 * Every value comes from a real monotonic clock: a cooldown sweep reflects
 * elapsed time, a charge count reflects real decrements/recharges, and neither
 * is set optimistically on a press. A skill never shows a cooldown it is not
 * actually in.
 *
 * @module skills/cooldown
 * @license GPL-3.0-only
 */

import type { Skill, SkillCharges } from "./types";

/** A live cooldown window keyed by (droneId, skillId). */
interface CooldownWindow {
  /** Epoch ms the window started. */
  startedAt: number;
  /** Total window length (ms). */
  durationMs: number;
}

/** A live charge budget keyed by (droneId, skillId). */
interface ChargeState {
  current: number;
  max: number;
  rechargeMs: number;
  /** Epoch ms the most recent charge consumption happened (recharge anchor). */
  lastSpentAt: number;
}

const cooldowns = new Map<string, CooldownWindow>();
const charges = new Map<string, ChargeState>();

/** A monotonic recompute callback the dispatcher injects (registry recompute). */
let onTick: (() => void) | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
/** Epoch ms the pending tick fires at (valid while `tickTimer` is set). */
let tickAt = 0;

function key(droneId: string, skillId: string): string {
  return `${droneId}::${skillId}`;
}

function now(): number {
  return Date.now();
}

/**
 * Wire the recompute callback the cooldown clock calls when a window or a
 * recharge boundary should refresh the bar. Called once from the dispatcher.
 */
export function setCooldownTick(fn: () => void): void {
  onTick = fn;
}

/**
 * Schedule one recompute at the earliest boundary across all live cooldown
 * windows and pending recharges. The sweep itself animates in CSS from the
 * window's start and length, so the bar is recomputed only when a window ends
 * or a charge comes back, never per frame. A single coalesced timer drives
 * every drone/skill; a boundary earlier than the pending one re-arms it.
 */
function scheduleTick(): void {
  if (!onTick) return;

  const next = nextBoundaryMs();
  if (next === null) return;
  const at = now() + next;
  if (tickTimer !== null) {
    if (tickAt <= at) return;
    clearTimeout(tickTimer);
  }

  tickAt = at;
  tickTimer = setTimeout(() => {
    tickTimer = null;
    reconcile();
    onTick?.();
    // Re-arm while any window or recharge is still outstanding.
    scheduleTick();
  }, Math.max(0, next));
}

/** Ms until the soonest cooldown-end or recharge boundary, or null if idle. */
function nextBoundaryMs(): number | null {
  const t = now();
  let soonest: number | null = null;

  for (const win of cooldowns.values()) {
    const remaining = win.startedAt + win.durationMs - t;
    if (remaining > 0 && (soonest === null || remaining < soonest)) {
      soonest = remaining;
    }
  }
  for (const ch of charges.values()) {
    if (ch.current >= ch.max) continue;
    const remaining = ch.lastSpentAt + ch.rechargeMs - t;
    const r = Math.max(0, remaining);
    if (soonest === null || r < soonest) soonest = r;
  }
  return soonest;
}

/** Drop elapsed cooldowns and credit elapsed recharges. Idempotent. */
function reconcile(): void {
  const t = now();

  for (const [k, win] of cooldowns) {
    if (win.startedAt + win.durationMs <= t) cooldowns.delete(k);
  }

  for (const ch of charges.values()) {
    if (ch.current >= ch.max) continue;
    const elapsed = t - ch.lastSpentAt;
    if (elapsed <= 0 || ch.rechargeMs <= 0) continue;
    const gained = Math.floor(elapsed / ch.rechargeMs);
    if (gained <= 0) continue;
    ch.current = Math.min(ch.max, ch.current + gained);
    // Advance the anchor by the consumed whole intervals so the next partial
    // interval is not lost (keeps recharge cadence exact across reconciles).
    ch.lastSpentAt += gained * ch.rechargeMs;
    if (ch.current >= ch.max) ch.lastSpentAt = t;
  }
}

/**
 * Ensure a charge record exists for a skill that declares one, seeded from its
 * declared budget. Returns the live record, or null when the skill has no
 * charges. The full max starts available (never optimistically depleted).
 */
function ensureCharges(
  droneId: string,
  skill: Skill,
): ChargeState | null {
  const spec: SkillCharges | undefined = skill.charges;
  if (!spec) return null;
  const k = key(droneId, skill.id);
  let rec = charges.get(k);
  if (!rec) {
    rec = {
      current: Math.max(0, Math.min(spec.max, spec.current)),
      max: spec.max,
      rechargeMs: spec.rechargeMs,
      lastSpentAt: now(),
    };
    charges.set(k, rec);
  }
  return rec;
}

/**
 * Whether a charge-bearing skill currently has a charge to spend. Reconciles
 * recharges first so a freshly-recharged skill reads true. Skills without
 * charges always return true (unlimited).
 */
export function hasCharge(droneId: string, skill: Skill): boolean {
  if (!skill.charges) return true;
  reconcile();
  const rec = ensureCharges(droneId, skill);
  return rec ? rec.current > 0 : true;
}

/**
 * Spend one charge for a charge-bearing skill, anchoring the recharge clock.
 * No-op for a skill without charges. Schedules the recharge tick.
 */
export function spendCharge(droneId: string, skill: Skill): void {
  if (!skill.charges) return;
  reconcile();
  const rec = ensureCharges(droneId, skill);
  if (!rec) return;
  if (rec.current > 0) {
    rec.current -= 1;
    rec.lastSpentAt = now();
  }
  scheduleTick();
}

/**
 * Start a real cooldown window for a skill that declares `cooldownMs`. No-op
 * for a skill without one. Schedules the sweep tick.
 */
export function startCooldown(droneId: string, skill: Skill): void {
  const ms = skill.cooldownMs;
  if (!ms || ms <= 0) return;
  cooldowns.set(key(droneId, skill.id), {
    startedAt: now(),
    durationMs: ms,
  });
  scheduleTick();
}

/**
 * The live cooldown projection for a skill, or null when no window is active.
 * `progress` sweeps 1 -> 0 across the window; `startedAt`/`durationMs` let the
 * slot animate the sweep itself.
 */
export function getCooldownState(
  droneId: string,
  skillId: string,
): {
  progress: number;
  remainingMs: number;
  startedAt: number;
  durationMs: number;
} | null {
  const win = cooldowns.get(key(droneId, skillId));
  if (!win) return null;
  const elapsed = now() - win.startedAt;
  const remainingMs = win.durationMs - elapsed;
  if (remainingMs <= 0) {
    cooldowns.delete(key(droneId, skillId));
    return null;
  }
  const progress = Math.max(0, Math.min(1, remainingMs / win.durationMs));
  return {
    progress,
    remainingMs,
    startedAt: win.startedAt,
    durationMs: win.durationMs,
  };
}

/**
 * The current charge count for a charge-bearing skill, or null when the skill
 * has no charge budget. Reconciles recharges so the badge reflects the real
 * present count.
 */
export function getChargeCount(
  droneId: string,
  skill: Skill,
): { current: number; max: number } | null {
  if (!skill.charges) return null;
  reconcile();
  const rec = ensureCharges(droneId, skill);
  if (!rec) return null;
  return { current: rec.current, max: rec.max };
}

/** Test/reset seam: clear all live cooldown + charge state. */
export function resetCooldownState(): void {
  cooldowns.clear();
  charges.clear();
  if (tickTimer !== null) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
}
