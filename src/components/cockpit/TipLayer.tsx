"use client";

/**
 * @module cockpit/TipLayer
 * @description The flight screen's contextual tips (cockpit spec
 * `tips.json`): one small panel at a time, beside the element it explains,
 * on the side with the most room and never over the spec's
 * `never_cover_zones` (STOP, the left column, the flight-state chip, the
 * alert stack, the top bar). An anchor with no room for the panel beside it
 * reports as not laid out, so the queue skips its tip without marking it
 * seen. No scrim: only the panel takes input, so taps elsewhere reach the
 * screen. A tap on the tip, on its anchor, or any controller button
 * dismisses a drawn tip. Mount once inside the flight-screen root.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";

import { useFlightSheetStore } from "@/components/cockpit/flight/flight-sheet";
import { pickerSkills } from "@/components/cockpit/v2/SkillPicker";
import { useCockpitTips, type CockpitTipsUi } from "@/hooks/use-cockpit-tips";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { specString } from "@/lib/cockpit/spec-strings";
import tipsJson from "@/lib/cockpit-spec/tips.json";
import { placeTip, type TipPlacement, type TipRect } from "@/lib/hud/tips";
import { useSkillRegistry } from "@/lib/skills";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useInputStore } from "@/stores/input-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useSkillInputStore } from "@/stores/skill-input-store";

/** Each tip anchor (and avoided zone) to the element that draws it on the
 *  flight screen. */
export const TIP_ANCHOR_SELECTORS: Readonly<Record<string, string>> = {
  status_pill: "[data-testid='status-pill']",
  flight_state_chip: "[data-testid='flight-state-chip']",
  layer_button: "[data-testid='layer-level-button']",
  stop: "[data-testid='cockpit-kill']",
  skill_picker_chip: "[data-testid='skill-picker-chip']",
  bottom_left_card: "[data-zone='bottom_left_card']",
  gimbal_pad: "[data-testid='fs-gimbal_pad']",
  left_column: "[data-zone='left_column']",
  alert_stack: "[data-zone='alert_stack']",
  top_bar: "[data-zone='top_bar']",
};

/** The zones a tip never covers (`rules.never_cover_zones`). */
const NEVER_COVER: readonly string[] = tipsJson.rules.never_cover_zones;
const ANCHORS: readonly string[] = [...new Set(tipsJson.tips.map((t) => t.anchor))];
/** The flight menu, which counts as an open sheet for the tips. */
const MENU_SELECTOR = "[data-testid='fs-menu']";
/** Panel width (px) and the height used before the panel is measured. */
const TIP_W = 260;
const TIP_H_GUESS = 88;

interface Measured {
  /** The layer's own box, the viewport tips are placed in. */
  viewport: TipRect;
  rects: Record<string, TipRect | null>;
  menuOpen: boolean;
}

function rectOf(el: Element | null, origin: DOMRect): TipRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
}

function measure(layer: HTMLElement): Measured {
  const scope = layer.parentElement ?? document.body;
  const origin = layer.getBoundingClientRect();
  const rects: Record<string, TipRect | null> = {};
  for (const [id, sel] of Object.entries(TIP_ANCHOR_SELECTORS)) rects[id] = rectOf(scope.querySelector(sel), origin);
  // The alert stack is drawn in two places (critical alerts and the flow
  // banners); a tip avoids, and waits for, every part of it.
  rects.alert_stack = null;
  for (const el of scope.querySelectorAll(TIP_ANCHOR_SELECTORS.alert_stack)) {
    const r = rectOf(el, origin);
    const u: TipRect | null = rects.alert_stack;
    if (!r) continue;
    if (!u) {
      rects.alert_stack = r;
      continue;
    }
    const x = Math.min(u.x, r.x);
    const y = Math.min(u.y, r.y);
    rects.alert_stack = { x, y, w: Math.max(u.x + u.w, r.x + r.w) - x, h: Math.max(u.y + u.h, r.y + r.h) - y };
  }
  return {
    viewport: { x: 0, y: 0, w: origin.width, h: origin.height },
    rects,
    menuOpen: scope.querySelector(MENU_SELECTOR) !== null,
  };
}

export function TipLayer({ droneId }: { droneId: string }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<Measured | null>(null);
  const [tipH, setTipH] = useState(TIP_H_GUESS);
  const tipHRef = useRef(TIP_H_GUESS);
  const lastKey = useRef("");
  const vehicleClass = usePilotState(droneId).pilot?.vehicleClass ?? null;

  const placeIn = (at: Measured | null, anchor: TipRect | null | undefined, h: number): TipPlacement | null => {
    if (!at || !anchor) return null;
    const avoid = NEVER_COVER.map((z) => at.rects[z]).filter((r): r is TipRect => Boolean(r));
    return placeTip(anchor, { w: TIP_W, h }, at.viewport, avoid);
  };

  // Called by the queue inside its own tick: the DOM and the open overlays
  // are read at that instant, never from an earlier measurement.
  const readUi = (): CockpitTipsUi => {
    const layer = layerRef.current;
    const now = layer ? measure(layer) : null;
    if (now) {
      const key = JSON.stringify(now);
      if (key !== lastKey.current) {
        lastKey.current = key;
        setM(now);
      }
    }
    // An anchor counts as shown only with room for the panel beside it.
    const anchorsVisible: Record<string, boolean> = {};
    for (const a of ANCHORS) anchorsVisible[a] = placeIn(now, now?.rects[a], tipHRef.current) !== null;
    const input = useSkillInputStore.getState();
    const skills = [...useSkillRegistry.getState().skills.values()];
    return {
      anchorsVisible,
      // Overlays outside the sheet store count as open sheets too.
      sheetOrMenuOpen:
        useFlightSheetStore.getState().open !== null ||
        now?.menuOpen === true ||
        input.paletteOpen ||
        input.editorOpen ||
        input.radialOpen ||
        useFlyQuickSettingsStore.getState().isOpen ||
        useSkillConfirmStore.getState().pending !== null,
      skillsAvailable: pickerSkills(skills, vehicleClass).length > 0,
      gimbalAvailable: Boolean(now?.rects.gimbal_pad),
      alertBannerVisible: Boolean(now?.rects.alert_stack),
    };
  };
  const { tip, dismiss } = useCockpitTips(droneId, readUi);
  const placement = tip ? placeIn(m, m?.rects[tip.anchor], tipH) : null;
  const drawn = tip !== null && placement !== null;

  // A tap on the anchor, or any controller button, dismisses a drawn tip.
  useEffect(() => {
    if (!tip || !drawn) return;
    const sel = TIP_ANCHOR_SELECTORS[tip.anchor];
    const onDown = (e: PointerEvent) => {
      if (sel && e.target instanceof Element && e.target.closest(sel)) dismiss();
    };
    document.addEventListener("pointerdown", onDown, true);
    const unsub = useInputStore.subscribe((s, prev) => {
      if (s.buttons !== prev.buttons && s.buttons.some((b, i) => b && !prev.buttons[i])) dismiss();
    });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      unsub();
    };
  }, [tip, drawn, dismiss]);

  useLayoutEffect(() => {
    const h = panelRef.current?.offsetHeight ?? 0;
    if (h > 0 && h !== tipH) {
      tipHRef.current = h;
      setTipH(h);
    }
  });

  const onPanelClick = (e: MouseEvent) => {
    e.stopPropagation();
    dismiss();
  };

  return (
    <div
      ref={layerRef}
      data-testid="tip-layer"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 45 }}
    >
      {tip && placement && (
        <div
          ref={panelRef}
          role="status"
          data-testid="cockpit-tip"
          data-tip={tip.id}
          data-side={placement.side}
          onClick={onPanelClick}
          style={{
            position: "absolute",
            left: placement.x,
            top: placement.y,
            width: TIP_W,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "var(--fs-gap, 8px)",
            padding: "var(--fs-pad, 10px)",
            background: "var(--fs-bg)",
            backdropFilter: "blur(var(--fs-blur, 16px))",
            border: "var(--fs-border-px, 1px) solid var(--fs-border)",
            borderRadius: "var(--fs-radius, 12px)",
            color: "var(--fs-text)",
            fontSize: 13,
            lineHeight: 1.35,
          }}
        >
          <p>{tip.text}</p>
          <button
            type="button"
            data-testid="cockpit-tip-dismiss"
            onClick={onPanelClick}
            style={{
              alignSelf: "flex-end",
              minHeight: 48,
              minWidth: 48,
              padding: "0 12px",
              borderRadius: "var(--fs-radius-sm, 8px)",
              border: "var(--fs-border-px, 1px) solid var(--fs-border)",
              background: "transparent",
              color: "var(--fs-text)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {specString("tips.dismiss")}
          </button>
        </div>
      )}
    </div>
  );
}
