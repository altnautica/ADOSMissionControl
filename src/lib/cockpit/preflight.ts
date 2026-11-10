/**
 * @module cockpit/preflight
 * @description The pre-flight checklist that gates the first arm of a
 * session, built from the same sources on every surface: the pilot's
 * readiness items, the flight controller's own pre-arm checks, the vehicle
 * link, the navigation source, the battery, the controller (when the pilot
 * flies the sticks) and on-board storage. Texts come from the spec
 * (`flow.preflight.*`). A failing item blocks the first arm; a warning is
 * shown and accepted by passing the checklist.
 *
 * @license GPL-3.0-only
 */

import type { FcStatusText, ReadinessItem } from "@/lib/hud/cockpit-frames";
import type { BatteryReading } from "@/lib/hud/battery";
import type { NavSourceResult } from "@/lib/hud/nav-source";
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
    label: text ? specText("flow.preflight.fc_prearm.failing", { text }) : specText("flow.preflight.fc_prearm"),
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
  /** The vehicle link is fresh. */
  live: boolean;
  /** The resolved navigation source, or null before any report. */
  nav: NavSourceResult | null;
  /** The trusted battery reading, or null when unknown. */
  battery: BatteryReading | null;
  /** The low band (percent) the battery must be above. */
  batteryLowPct: number;
  /** Who flies the sticks; the controller item shows only for `ados`. */
  controlMode: "ados" | "fc_manual" | "elrs" | null;
  controller: { connected: boolean; name: string | null };
  /** On-board storage use (percent), or null when not reported. */
  storagePct: number | null;
}

/** The checklist, in display order. */
export function preflightItems(i: PreflightInputs): PreflightItem[] {
  const items: PreflightItem[] = [];
  for (const r of i.readiness) {
    items.push({ id: `pilot:${r.id}`, label: r.msg || r.id, state: r.ok ? "pass" : r.severity === "block" ? "fail" : "warn" });
  }
  const prearm = fcPrearmItem(i.prearm);
  if (prearm) items.push(prearm);
  items.push({ id: "link", label: specText("flow.preflight.link"), state: i.live ? "pass" : "fail" });
  const navOk = i.live && i.nav !== null && i.nav.kind !== "stale" && i.nav.tone !== "crit";
  items.push({ id: "nav_source", label: specText("flow.preflight.nav_source"), state: navOk ? "pass" : "warn" });
  items.push({
    id: "battery",
    label: specText("flow.preflight.battery"),
    state: i.battery !== null && i.battery.pct > i.batteryLowPct ? "pass" : "fail",
  });
  if (i.controlMode === "ados") {
    const { connected, name } = i.controller;
    items.push({
      id: "controller",
      label: connected
        ? name
          ? specText("flow.preflight.controller_named", { name })
          : specText("flow.preflight.controller")
        : specText("flow.preflight.controller_optional"),
      state: connected ? "pass" : "warn",
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
