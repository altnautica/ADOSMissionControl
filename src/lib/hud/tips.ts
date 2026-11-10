// Contextual tips on the flight screen (cockpit spec `tips.json`): one at a
// time, on the ground only, never over a sheet, a menu or the controller
// tour. Pure: the surface keeps `TipsState` per device, reports what is on
// screen in `TipsContext` and renders the decision.

import tipsJson from "../cockpit-spec/tips.json";

interface TipSpec {
  id: string;
  anchor: string;
  trigger: string;
  order: number;
}

const RULES = tipsJson.rules as {
  show_only_when: Record<string, boolean>;
  first_delay_ms: number;
  gap_between_ms: number;
  auto_dismiss_ms: number;
};

/** The tips in queue order. */
export const TIPS: readonly TipSpec[] = [...(tipsJson.tips as TipSpec[])].sort((a, b) => a.order - b.order);

/** What a device remembers: the tips dismissed for good and how often the
 *  flight screen has opened. */
export interface TipsState {
  seen: string[];
  openCount: number;
}

/** What is on screen now. */
export interface TipsContext {
  armed: boolean;
  airborne: boolean;
  flightScreen: boolean;
  sheetOrMenuOpen: boolean;
  tourVisible: boolean;
  skillsAvailable: boolean;
  gotoOffered: boolean;
  gimbalAvailable: boolean;
  /** Anchor id to whether it is laid out on screen now. */
  anchorsVisible: Record<string, boolean>;
  screenOpenedAtMs: number;
  /** When the last tip of this screen open was hidden, or null. */
  lastDismissedAtMs: number | null;
  /** The tip on screen now, and since when. */
  shownTipId: string | null;
  shownAtMs: number | null;
  /** Tips hidden on this screen open without being seen (auto-dismissed, or
   *  hidden when they stopped being allowed): not offered again until the
   *  next open. */
  hiddenThisOpen?: readonly string[];
  /** An alert banner or countdown shows in the top-centre alert stack.
   *  Omitted reads as none showing. */
  alertBannerVisible?: boolean;
}

export type TipDecision =
  | { kind: "none" }
  | { kind: "wait"; tipId: string; atMs: number }
  | { kind: "show"; tipId: string; textKey: string; anchor: string }
  | { kind: "hide"; tipId: string; markSeen: boolean; reason: "auto_dismiss" | "arm" | "not_allowed" };

const CONDITION_FIELDS: Readonly<Record<string, keyof TipsContext>> = {
  armed: "armed",
  airborne: "airborne",
  flight_screen: "flightScreen",
  sheet_or_menu_open: "sheetOrMenuOpen",
  tour_visible: "tourVisible",
  alert_banner_visible: "alertBannerVisible",
};

/** Whether every `show_only_when` condition holds. A condition this surface
 *  does not know never holds. */
function allowed(ctx: TipsContext): boolean {
  return Object.entries(RULES.show_only_when).every(([k, want]) => {
    const field = CONDITION_FIELDS[k];
    if (field === undefined) return false;
    const have = field === "alertBannerVisible" ? (ctx.alertBannerVisible ?? false) : ctx[field];
    return have === want;
  });
}

function triggered(trigger: string, state: TipsState, ctx: TipsContext): boolean {
  switch (trigger) {
    case "flight_screen_first_open":
      return ctx.flightScreen;
    case "flight_screen_second_open":
      return state.openCount >= 2;
    case "skills_available":
      return ctx.skillsAvailable;
    case "goto_offered":
      return ctx.gotoOffered;
    case "gimbal_available":
      return ctx.gimbalAvailable;
    default:
      return false;
  }
}

function show(t: TipSpec): TipDecision {
  return { kind: "show", tipId: t.id, textKey: `tips.${t.id}`, anchor: t.anchor };
}

/** What to do with tips now. */
export function nextTip(state: TipsState, ctx: TipsContext, nowMs: number): TipDecision {
  const ok = allowed(ctx);
  if (ctx.shownTipId !== null) {
    const id = ctx.shownTipId;
    const tip = TIPS.find((t) => t.id === id);
    // Arming dismisses a tip for good.
    if (ctx.armed) return { kind: "hide", tipId: id, markSeen: true, reason: "arm" };
    if (!ok || !tip || ctx.anchorsVisible[tip.anchor] !== true) return { kind: "hide", tipId: id, markSeen: false, reason: "not_allowed" };
    if (ctx.shownAtMs !== null && nowMs - ctx.shownAtMs >= RULES.auto_dismiss_ms) {
      return { kind: "hide", tipId: id, markSeen: false, reason: "auto_dismiss" };
    }
    return show(tip);
  }
  if (!ok) return { kind: "none" };
  const hidden = ctx.hiddenThisOpen ?? [];
  const next = TIPS.find(
    (t) => !state.seen.includes(t.id) && !hidden.includes(t.id) && triggered(t.trigger, state, ctx) && ctx.anchorsVisible[t.anchor] === true,
  );
  if (!next) return { kind: "none" };
  const firstAt = ctx.screenOpenedAtMs + RULES.first_delay_ms;
  const atMs = ctx.lastDismissedAtMs === null ? firstAt : Math.max(firstAt, ctx.lastDismissedAtMs + RULES.gap_between_ms);
  return nowMs < atMs ? { kind: "wait", tipId: next.id, atMs } : show(next);
}

/** The state after a tip is dismissed for good. */
export function dismissTip(state: TipsState, id: string): TipsState {
  return state.seen.includes(id) ? state : { ...state, seen: [...state.seen, id] };
}

/** The state after the flight screen opens. */
export function onFlightScreenOpen(state: TipsState): TipsState {
  return { ...state, openCount: state.openCount + 1 };
}

/** The state of a device that has seen no tip. */
export function resetTips(): TipsState {
  return { seen: [], openCount: 0 };
}

export interface TipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TipPlacement {
  x: number;
  y: number;
  side: "top" | "bottom" | "left" | "right";
}

/** Space between the anchor and the tip, in px. */
const TIP_GAP_PX = 8;

function intersects(a: TipRect, b: TipRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: TipRect, inner: TipRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Spots along one axis to try for a tip of length `len` in [lo, hi]: the
 *  centred spot first, then each spot just clear of an avoided rect, nearest
 *  the centre first. */
function slideSpots(centre: number, lo: number, hi: number, len: number, edges: readonly [number, number][]): number[] {
  const spots = [centre, lo, hi];
  for (const [a, b] of edges) spots.push(a - TIP_GAP_PX - len, b + TIP_GAP_PX);
  return spots.map((s) => Math.min(hi, Math.max(lo, s))).sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
}

/** Where a tip of `tipSize` goes beside `anchorRect`: on the side with the most
 *  free space inside `viewport`, slid along that side so it covers none of
 *  `avoidRects` (the `never_cover_zones` rects and the top bar). An avoided
 *  rect that contains the anchor (the top bar, for an anchor in the bar) is
 *  excepted for that anchor, and the tip goes below it, pushed further down
 *  past any avoided rect under it (the alert stack). Null when nothing fits. */
export function placeTip(
  anchorRect: TipRect,
  tipSize: { w: number; h: number },
  viewport: TipRect,
  avoidRects: readonly TipRect[],
): TipPlacement | null {
  const right = viewport.x + viewport.w;
  const bottom = viewport.y + viewport.h;
  const container = avoidRects
    .filter((r) => contains(r, anchorRect) && (r.w > anchorRect.w || r.h > anchorRect.h))
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (container) {
    const avoid = avoidRects.filter((r) => !contains(container, r));
    const centre = anchorRect.x + anchorRect.w / 2 - tipSize.w / 2;
    const lo = viewport.x;
    const hi = right - tipSize.w;
    const xs = slideSpots(centre, lo, hi, tipSize.w, avoid.map((r) => [r.x, r.x + r.w]));
    const ys = [container.y + container.h + TIP_GAP_PX, ...avoid.map((r) => r.y + r.h + TIP_GAP_PX)]
      .filter((y) => y >= container.y + container.h + TIP_GAP_PX && y + tipSize.h <= bottom)
      .sort((a, b) => a - b);
    for (const y of ys) {
      for (const x of xs) {
        const rect = { x, y, w: tipSize.w, h: tipSize.h };
        if (!avoid.some((r) => intersects(rect, r))) return { x, y, side: "bottom" };
      }
    }
    return null;
  }
  const sides: { side: TipPlacement["side"]; free: number }[] = [
    { side: "top" as const, free: anchorRect.y - viewport.y },
    { side: "bottom" as const, free: bottom - (anchorRect.y + anchorRect.h) },
    { side: "left" as const, free: anchorRect.x - viewport.x },
    { side: "right" as const, free: right - (anchorRect.x + anchorRect.w) },
  ].sort((a, b) => b.free - a.free);
  for (const { side, free } of sides) {
    const vertical = side === "top" || side === "bottom";
    if (free < (vertical ? tipSize.h : tipSize.w) + TIP_GAP_PX) continue;
    const fixed =
      side === "top"
        ? anchorRect.y - TIP_GAP_PX - tipSize.h
        : side === "bottom"
          ? anchorRect.y + anchorRect.h + TIP_GAP_PX
          : side === "left"
            ? anchorRect.x - TIP_GAP_PX - tipSize.w
            : anchorRect.x + anchorRect.w + TIP_GAP_PX;
    const lo = vertical ? viewport.x : viewport.y;
    const hi = vertical ? right - tipSize.w : bottom - tipSize.h;
    if (hi < lo) continue;
    const centre = vertical ? anchorRect.x + anchorRect.w / 2 - tipSize.w / 2 : anchorRect.y + anchorRect.h / 2 - tipSize.h / 2;
    const edges = avoidRects.map((r): [number, number] => (vertical ? [r.x, r.x + r.w] : [r.y, r.y + r.h]));
    for (const s of slideSpots(centre, lo, hi, vertical ? tipSize.w : tipSize.h, edges)) {
      const rect = vertical ? { x: s, y: fixed, w: tipSize.w, h: tipSize.h } : { x: fixed, y: s, w: tipSize.w, h: tipSize.h };
      if (!avoidRects.some((r) => intersects(rect, r))) return { x: rect.x, y: rect.y, side };
    }
  }
  return null;
}
