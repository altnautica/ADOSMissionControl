"use client";

/**
 * @module config/ControlsSettingsCards
 * @description The smaller cards of Settings › Controls: stick calibration
 * with the deadzone, the rumble / lightbar test row, the cockpit prefs row and
 * the "Replay controller tour" row (the tour itself is a card on the flight
 * screen).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import ds4Spec from "@/lib/cockpit-spec/ds4.json";
import { specString } from "@/lib/cockpit/spec-strings";
import { canRumble, lightbarColour, lightbarSupported, requestLightbarDevice, rumble, setLightbar } from "@/lib/input/ds4-feedback";
import { useControlsStore } from "@/stores/controls-store";
import { useInputStore } from "@/stores/input-store";
import { useCockpitPrefsStore } from "@/stores/cockpit-prefs-store";
import { useSettingsStore } from "@/stores/settings-store";
import { clashedUnboundSkills } from "@/stores/settings/keybindings-slice";
import { useSkillRegistry } from "@/lib/skills";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { useTranslations } from "next-intl";

const LIGHTBAR_STATES = Object.keys(ds4Spec.lightbar.states) as (keyof typeof ds4Spec.lightbar.states)[];

export function CalibrationCard() {
  const gamepadId = useInputStore((s) => s.gamepadId);
  const deadzone = useInputStore((s) => s.deadzone);
  const setDeadzone = useInputStore((s) => s.setDeadzone);
  const setCalibration = useInputStore((s) => s.setCalibration);
  const [rec, setRec] = useState<{ min: number[]; max: number[] } | null>(null);
  useEffect(() => {
    if (!rec) return;
    return useInputStore.subscribe((s) => {
      const a = s.padAxes;
      setRec((r) => (r ? { min: a.map((v, i) => Math.min(r.min[i] ?? v, v)), max: a.map((v, i) => Math.max(r.max[i] ?? v, v)) } : r));
    });
  }, [rec]);
  const finish = () => {
    const center = useInputStore.getState().padAxes.slice();
    if (gamepadId && rec && rec.min.length === center.length) setCalibration(gamepadId, { center, min: rec.min, max: rec.max });
    setRec(null);
  };
  return (
    <section className="rounded-lg border border-border-default p-3" data-testid="calibration-card">
      <h4 className="text-xs font-semibold">{specString("controls.calibrate.title")}</h4>
      <p className="mt-1 text-[11px] text-text-secondary">{specString("controls.calibrate.body")}</p>
      <div className="mt-2 flex items-center gap-2">
        {rec ? (
          <button type="button" onClick={finish} className="min-h-12 rounded bg-accent-primary/25 px-3 text-xs font-semibold text-accent-primary">
            Done (sticks released)
          </button>
        ) : (
          <button type="button" disabled={!gamepadId} onClick={() => setRec({ min: [], max: [] })} className="min-h-12 rounded border px-3 text-xs disabled:opacity-40">
            Start
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs">
          {specString("controls.deadzone")}
          <input type="range" min={0.04} max={0.2} step={0.01} value={deadzone} onChange={(e) => setDeadzone(Number(e.target.value))} aria-label={specString("controls.deadzone")} className="min-h-12" />
          <span className="w-10 font-mono tabular-nums">{deadzone.toFixed(2)}</span>
        </label>
      </div>
    </section>
  );
}

export function TestRow() {
  const [lightbar, setLightbarMsg] = useState<string | null>(null);
  const supported = lightbarSupported();
  const cycle = async () => {
    if (!(await requestLightbarDevice())) {
      setLightbarMsg("No controller granted");
      return;
    }
    for (const s of LIGHTBAR_STATES) {
      await setLightbar(lightbarColour(s, 0));
      await new Promise((r) => setTimeout(r, 600));
    }
    setLightbarMsg(null);
  };
  return (
    <section className="flex flex-wrap items-center gap-2" data-testid="controls-test-row">
      <button
        type="button"
        onClick={() => {
          rumble("mode_change");
          setTimeout(() => rumble("warning"), 500);
          setTimeout(() => rumble("critical"), 1200);
        }}
        disabled={!canRumble()}
        className="min-h-12 rounded border px-3 text-xs disabled:opacity-40"
      >
        {specString("controls.test.rumble")}
      </button>
      <button
        type="button"
        onClick={() => void cycle()}
        disabled={!supported}
        title={supported ? undefined : specString("controls.test.lightbar_unavailable")}
        className="min-h-12 rounded border px-3 text-xs disabled:opacity-40"
      >
        {specString("controls.test.lightbar")}
      </button>
      <span className="text-[11px] text-text-secondary">{specString("controls.test.sticks.hint", { sticks: specString("controls.test.sticks") })}</span>
      {lightbar && <span className="text-[11px] text-status-warning">{lightbar}</span>}
    </section>
  );
}

/** On-screen sticks (Controls) and voice prompts (Sound). */
export function PrefsRow() {
  const prefs = useCockpitPrefsStore();
  return (
    <section className="flex flex-wrap gap-4 text-xs" data-testid="cockpit-prefs">
      <label className="flex min-h-12 items-center gap-2">
        <input type="checkbox" checked={prefs.onScreenSticks} onChange={(e) => prefs.setOnScreenSticks(e.target.checked)} />
        {specString("flow.on_screen_sticks")}
      </label>
      <label className="flex min-h-12 items-center gap-2">
        <input type="checkbox" checked={prefs.voicePrompts} onChange={(e) => prefs.setVoicePrompts(e.target.checked)} />
        {specString("voice.setting")}
      </label>
    </section>
  );
}

/** Settings › Controls › Replay controller tour: the flight screen shows the
 *  tour card again on the next ground visit. */
export function ReplayTourRow() {
  const replay = useControlsStore((s) => s.replayTour);
  return (
    <section className="flex items-center justify-between gap-2 text-xs" data-testid="controls-tour-replay-row">
      <span>{specString("controls.tour.title")}</span>
      <button type="button" onClick={() => replay()} data-testid="controls-tour-replay" className="min-h-12 rounded border px-3 text-xs">
        {specString("controls.tour.replay")}
      </button>
    </section>
  );
}

/** Extension skills whose suggested key or button clashed with another
 * binding: they sit in the active loadout unbound until the operator binds
 * them. */
export function ClashedSkills() {
  const t = useTranslations();
  const loadout = useSettingsStore((s) => s.loadouts[s.activeLoadoutId]);
  const skills = useSkillRegistry((s) => s.skills);
  const ids = clashedUnboundSkills(loadout);
  if (ids.length === 0) return null;
  const labels = ids.map((id) => {
    const skill = skills.get(id);
    return skill ? skillDisplayLabel(skill, t) : id;
  });
  return (
    <section data-testid="controls-unbound-skills" className="rounded-lg border border-status-warning/50 bg-status-warning/10 p-3 text-xs">
      {t("extensions.bindings.unbound", { skills: labels.join(", ") })}
    </section>
  );
}
