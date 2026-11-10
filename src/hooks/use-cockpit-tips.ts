/**
 * @module hooks/use-cockpit-tips
 * @description The flight screen's contextual tip queue (cockpit spec
 * `tips.json`, shared engine `@/lib/hud/tips`): one tip at a time, on the
 * ground and disarmed only, never while a sheet, menu or the controller tour
 * is open. Mount once per flight screen; the caller draws the tip next to its
 * anchor (`placeTip`) and calls `dismiss` on a tap on the tip or its anchor or
 * on any controller button. Arming hides the tip and marks it seen; the
 * auto-dismiss hides it without marking it seen.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useState } from "react";

import { nextTip, type TipsContext } from "@/lib/hud/tips";
import { specText } from "@/lib/hud/spec-text";
import { gotoAdvertised } from "@/lib/hud/fly-here-offer";
import { vehicleLanded } from "@/lib/skills/flight-facts";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useCockpitTipsStore } from "@/stores/cockpit-tips-store";
import { useControlsStore } from "@/stores/controls-store";
import { useDroneStore } from "@/stores/drone-store";

/** How often the queue is re-evaluated (delays, auto-dismiss, anchors). */
const TIPS_TICK_MS = 250;

/** What only the flight screen itself knows. */
export interface CockpitTipsUi {
  /** Anchor id (`status_pill`, `stop`, ...) to whether it is laid out now. */
  anchorsVisible: Record<string, boolean>;
  sheetOrMenuOpen: boolean;
  /** The skill picker lists at least one skill. */
  skillsAvailable: boolean;
  /** The gimbal rate endpoint answered `available: true`. */
  gimbalAvailable: boolean;
  /** A banner or countdown shows in the alert stack (`alert_stack` zone):
   *  no tip then (`show_only_when.alert_banner_visible: false`). */
  alertBannerVisible: boolean;
}

export interface CockpitTip {
  id: string;
  anchor: string;
  text: string;
}

export interface CockpitTips {
  tip: CockpitTip | null;
  /** The operator dismissed the tip (tap, anchor tap, controller button). */
  dismiss: () => void;
}

interface OpenState {
  openedAt: number;
  lastDismissedAt: number | null;
  shown: { id: string; anchor: string; at: number } | null;
  hidden: string[];
}

/** The pure step: the context the engine reads, from what the screen shows. */
export function tipsContext(
  ui: CockpitTipsUi,
  facts: { armed: boolean; airborne: boolean; tourVisible: boolean; gotoOffered: boolean },
  open: OpenState,
): TipsContext {
  return {
    armed: facts.armed,
    airborne: facts.airborne,
    flightScreen: true,
    sheetOrMenuOpen: ui.sheetOrMenuOpen,
    tourVisible: facts.tourVisible,
    skillsAvailable: ui.skillsAvailable,
    gotoOffered: facts.gotoOffered,
    gimbalAvailable: ui.gimbalAvailable,
    alertBannerVisible: ui.alertBannerVisible,
    anchorsVisible: ui.anchorsVisible,
    screenOpenedAtMs: open.openedAt,
    lastDismissedAtMs: open.lastDismissedAt,
    shownTipId: open.shown?.id ?? null,
    shownAtMs: open.shown?.at ?? null,
    hiddenThisOpen: open.hidden,
  };
}

export function useCockpitTips(droneId: string, ui: CockpitTipsUi): CockpitTips {
  const { pilot } = usePilotState(droneId);
  const armState = useDroneStore((s) => s.armState);
  const tourVisible = useControlsStore((s) => s.tourVisible);
  const open = useRef<OpenState>({ openedAt: 0, lastDismissedAt: null, shown: null, hidden: [] });
  const [tip, setTip] = useState<CockpitTip | null>(null);

  // One flight-screen open per mount (the second-open tip counts these).
  useEffect(() => {
    open.current = { openedAt: Date.now(), lastDismissedAt: null, shown: null, hidden: [] };
    useCockpitTipsStore.getState().opened();
  }, []);

  const armed = armState === "armed" || pilot?.armed === true;
  const airborne = (pilot ? pilot.armed && !pilot.landed : false) || vehicleLanded(droneId) === false;
  const facts = { armed, airborne, tourVisible, gotoOffered: gotoAdvertised(pilot) };
  const step = useRef<() => void>(() => undefined);
  // The latest render's inputs, read by the interval below.
  useEffect(() => {
    step.current = () => {
      const now = Date.now();
      const o = open.current;
      const state = useCockpitTipsStore.getState();
      const d = nextTip(state, tipsContext(ui, facts, o), now);
      if (d.kind === "show") {
        if (o.shown?.id !== d.tipId) o.shown = { id: d.tipId, anchor: d.anchor, at: now };
        setTip((t) => (t?.id === d.tipId ? t : { id: d.tipId, anchor: d.anchor, text: specText(d.textKey) }));
      } else if (d.kind === "hide") {
        if (d.markSeen) state.dismiss(d.tipId);
        else o.hidden = [...o.hidden, d.tipId];
        o.shown = null;
        o.lastDismissedAt = now;
        setTip(null);
      } else {
        setTip(null);
      }
    };
  });

  useEffect(() => {
    step.current();
    const id = setInterval(() => step.current(), TIPS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const dismiss = () => {
    const o = open.current;
    if (!o.shown) return;
    useCockpitTipsStore.getState().dismiss(o.shown.id);
    o.shown = null;
    o.lastDismissedAt = Date.now();
    setTip(null);
  };

  return { tip, dismiss };
}
