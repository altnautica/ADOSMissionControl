/**
 * @module cockpit/preflight
 * @description The pre-flight checklist that gates the first arm of a
 * session. It starts with the shared pre-flight checks every surface
 * evaluates (`@/lib/hud/preflight`: link, GPS, battery, home), then the
 * pilot's readiness items, the flight controller's own pre-arm checks, and
 * this app's navigation source, controller (when the pilot flies the
 * sticks) and on-board storage items. Texts come from the spec. A failing
 * or warning item names the fault, never the check as if it passed, and
 * carries no source prefix. A failing item blocks the first arm; a warning
 * is shown and accepted by passing the checklist.
 *
 * @license GPL-3.0-only
 */

import type { FcStatusText, ReadinessItem } from "@/lib/hud/cockpit-frames";
import type { NavSourceResult } from "@/lib/hud/nav-source";
import type { PreflightCheck } from "@/lib/hud/preflight";
import { specText } from "@/lib/hud/spec-text";
import { STORAGE_CRIT_PCT, STORAGE_WARN_PCT } from "@/lib/hud/status-pill";

export type PreflightState = "pass" | "warn" | "fail";

export interface PreflightItem {
  id: string;
  label: string;
  state: PreflightState;
}

const PREARM_TEXT = /^(PreArm|Arm):\s*/;

/** The flight controller's own pre-arm checks: failing while it reports a
 *  PreArm/Arm text (the newest, last in the list, is shown), passing when it
 *  reports none. Null while the pre-arm state is unknown (no link, or a
 *  vehicle that reports neither texts nor the pre-arm health bit). */
export function fcPrearmItem(prearm: readonly string[] | undefined): PreflightItem | null {
  if (!Array.isArray(prearm)) return null;
  if (prearm.length === 0) return { id: "fc_prearm", label: specText("flow.preflight.fc_prearm"), state: "pass" };
  const text = prearm[prearm.length - 1].replace(PREARM_TEXT, "");
  return {
    id: "fc_prearm",
    // The fault itself, without the "Flight controller:" source prefix.
    label: text || specText("flow.preflight.fc_prearm"),
    state: "fail",
  };
}

/** On-board storage: fails at or above the spec's critical fill, warns at its
 *  warning fill, warns when the node does not report it. */
export function storageItem(pct: number | null): PreflightItem {
  if (pct === null || !Number.isFinite(pct)) {
    return { id: "storage", label: specText("flow.preflight.storage.unknown"), state: "warn" };
  }
  return {
    id: "storage",
    label: specText("flow.preflight.storage.used", { pct: Math.round(pct) }),
    state: pct >= STORAGE_CRIT_PCT ? "fail" : pct >= STORAGE_WARN_PCT ? "warn" : "pass",
  };
}

export interface FcPrearmSources {
  /** The pilot's FC STATUSTEXT ring (newest first), when the agent runs the pilot. */
  pilotStatustext: readonly FcStatusText[] | null;
  /** The SYS_STATUS pre-arm health bit: true healthy, false failing, null unreported. */
  sysStatusPrearmOk: boolean | null;
  /** PreArm STATUSTEXT lines received over a direct link, oldest first. */
  directLines: readonly string[];
}

/**
 * The FC's current pre-arm texts, oldest first. The pilot's ring holds only
 * recent lines, so its PreArm/Arm lines are the list. Over a direct link the
 * buffered lines have no age, so they count only while the FC's own pre-arm
 * bit says it is failing; a failing bit with no line reads as one untitled
 * failure. Undefined while neither source reports anything.
 */
export function fcPrearmTexts(s: FcPrearmSources): readonly string[] | undefined {
  if (s.pilotStatustext) {
    const lines: string[] = [];
    for (let i = s.pilotStatustext.length - 1; i >= 0; i--) {
      const t = s.pilotStatustext[i].text;
      if (PREARM_TEXT.test(t)) lines.push(t);
    }
    if (lines.length > 0) return lines;
  } else if (s.sysStatusPrearmOk === null) {
    return undefined;
  }
  if (s.sysStatusPrearmOk !== false) return [];
  return s.directLines.length > 0 ? s.directLines : ["PreArm:"];
}

export interface PreflightInputs {
  /** The pilot's readiness items; empty without a pilot. */
  readiness: readonly ReadinessItem[];
  /** The FC's pre-arm texts (`fcPrearmTexts`); undefined while unknown. */
  prearm: readonly string[] | undefined;
  /** The shared pre-flight checks (`preflightChecks`), in their order. */
  checks: readonly PreflightCheck[];
  /** The vehicle link is fresh. */
  live: boolean;
  /** The resolved navigation source, or null before any report. */
  nav: NavSourceResult | null;
  /** Who flies the sticks; the controller item shows only for `ados`. */
  controlMode: "ados" | "fc_manual" | "elrs" | null;
  controller: { connected: boolean; name: string | null };
  /** The cockpit's on-screen sticks are shown: they stand in for a controller. */
  onScreenSticks: boolean;
  /** On-board storage use (percent), or null when not reported. */
  storagePct: number | null;
}

/** A shared check's words: its failure text when it fails and the check
 *  carries one, else its label. */
function checkLabel(c: PreflightCheck): string {
  const fail = (c as PreflightCheck & { fail?: string }).fail;
  return !c.ok && typeof fail === "string" && fail ? fail : c.label;
}

/** The source word of a nav source kind, for the degraded text. */
const NAV_WORD: Record<string, string> = {
  gps: "nav_source.gps",
  ext: "nav_source.ext_nav",
  flow: "nav_source.flow",
  dr: "nav_source.dr",
};

/** The navigation source item: degraded names the source; no report says so. */
function navItem(i: PreflightInputs): PreflightItem {
  const label = specText("flow.preflight.nav_source");
  if (!i.live || i.nav === null || i.nav.kind === "stale") {
    return { id: "nav_source", label: specText("flow.preflight.not_reported", { item: label }), state: "warn" };
  }
  if (i.nav.tone === "crit") {
    const word = NAV_WORD[i.nav.kind];
    return {
      id: "nav_source",
      label: specText("alert.nav_source_degraded", { source: word ? specText(word) : i.nav.kind }),
      state: "warn",
    };
  }
  return { id: "nav_source", label, state: "pass" };
}

/** The checklist, in display order: the shared checks first. */
export function preflightItems(i: PreflightInputs): PreflightItem[] {
  const items: PreflightItem[] = i.checks.map((c) => ({ id: c.id, label: checkLabel(c), state: c.ok ? "pass" : "fail" }));
  for (const r of i.readiness) {
    items.push({ id: `pilot:${r.id}`, label: r.msg || r.id, state: r.ok ? "pass" : r.severity === "block" ? "fail" : "warn" });
  }
  const prearm = fcPrearmItem(i.prearm);
  if (prearm) items.push(prearm);
  items.push(navItem(i));
  if (i.controlMode === "ados") {
    const { connected, name } = i.controller;
    const ok = connected || i.onScreenSticks;
    items.push({
      id: "controller",
      label: connected
        ? name
          ? specText("flow.preflight.controller_named", { name })
          : specText("flow.preflight.controller")
        : i.onScreenSticks
          ? specText("flow.preflight.controller_optional")
          : specText("controls.no_controller"),
      state: ok ? "pass" : "warn",
    });
  }
  items.push(storageItem(i.storagePct));
  return items;
}

/** The first-arm gate: the checklist can be passed when no item fails.
 *  Warnings are accepted by passing it. */
export function firstArmAllowed(items: readonly PreflightItem[]): boolean {
  return items.every((i) => i.state !== "fail");
}
