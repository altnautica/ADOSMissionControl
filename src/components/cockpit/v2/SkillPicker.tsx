"use client";

/**
 * The skill picker (bottom-right): a chip showing the active skill, which
 * opens a sheet with tabs Behaviors / Camera / Navigation / Utility. Each
 * plugin's skills are grouped under its name. Selecting a skill opens its
 * Tweak panel (the manifest `params`), then GO; Stop hands back to the pilot
 * hold. One `motion` skill runs at a time: GO on a second one first stops the
 * active one and waits for its echo (or 1 s). A write shows a pending ring
 * until the state echo; after 3 s it reverts with a toast.
 *
 * @module cockpit/v2/SkillPicker
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFlightSheet, useSheetDismiss } from "@/components/cockpit/flight/flight-sheet";
import { Sparkles } from "lucide-react";

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { usePluginConfigCache, pluginConfigKey } from "@/lib/plugins/config-cache";
import { activate, buildSkillContext, deactivate, useSkillRegistry, type Skill } from "@/lib/skills";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { onPickerCommand, usePickerStore } from "@/lib/cockpit/picker-commands";
import { specString } from "@/lib/cockpit/spec-strings";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { useDronePluginParameters } from "@/hooks/use-drone-plugin-contributions";
import { SkillTweakPanel, stepValue } from "./SkillTweakPanel";

export { paramLabel } from "./SkillTweakPanel";

export const PICKER_TABS = ["behavior", "camera", "navigation", "utility"] as const;
export type PickerTab = (typeof PICKER_TABS)[number];

/** The skill state colour (`tokens.json` `state.skill`). */
const SKILL_COLOR = tokens.state.skill;

/** A write is pending until the state echo; after this it reverts. */
export const ECHO_TIMEOUT_MS = 3000;
/** Preemption waits this long for the active skill's echo before GO. */
export const PREEMPT_WAIT_MS = 1000;
/** Plugin state older than this dims its entry with "last seen". */
export const SKILL_STATE_STALE_MS = 3000;

/** "last seen <n> s" when a plugin's state is older than the stale limit. */
export function lastSeenText(seenAt: number | undefined, now: number): string | null {
  if (seenAt === undefined) return null;
  const age = now - seenAt;
  return age > SKILL_STATE_STALE_MS ? specString("skill.last_seen", { n: Math.floor(age / 1000) }) : null;
}

/** Skills the picker offers for a vehicle class (manifest `vehicle_classes`). */
export function pickerSkills(skills: Skill[], vehicleClass: PilotState["vehicleClass"]): Skill[] {
  return skills.filter(
    (s) =>
      s.source === "plugin" &&
      (!vehicleClass || !s.vehicleClasses || s.vehicleClasses.includes(vehicleClass)),
  );
}

/** Group a tab's skills under their plugin, in registration order. */
export function groupByPlugin(skills: Skill[], tab: PickerTab): [string, Skill[]][] {
  const groups = new Map<string, Skill[]>();
  for (const s of skills) {
    if ((s.pickerCategory ?? "behavior") !== tab) continue;
    const pid = s.pluginId ?? "plugin";
    groups.set(pid, [...(groups.get(pid) ?? []), s]);
  }
  return [...groups.entries()];
}

interface SkillPickerProps {
  droneId: string;
  pilot: PilotState | null;
  notify?: (msg: string) => void;
}

export function SkillPicker({ droneId, pilot, notify }: SkillPickerProps) {
  const t = useTranslations();
  const registry = useSkillRegistry((s) => s.skills);
  const states = useSkillRegistry((s) => s.states.get(droneId));
  const [open, setOpen] = useFlightSheet("skills");
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeSheet = useCallback(() => setOpen(false), [setOpen]);
  useSheetDismiss(sheetRef, closeSheet, "[data-sheet-trigger='skills']", open);
  const [tab, setTab] = useState<PickerTab>("behavior");
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; want: boolean; at: number } | null>(null);
  // A Stop pressed while the link is down waits here until it returns.
  const [queuedStop, setQueuedStop] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  const skills = useMemo(
    () => pickerSkills([...registry.values()], pilot?.vehicleClass ?? null),
    [registry, pilot?.vehicleClass],
  );
  const stateOf = useCallback(
    (id: string) => states?.get(id) ?? { kind: "idle" as const },
    [states],
  );
  const active = skills.find((s) => stateOf(s.id).kind === "active") ?? null;
  const activeMotion = skills.find((s) => s.motion && stateOf(s.id).kind === "active") ?? null;

  // Echo: the pending ring clears when the state matches the write (derived
  // during render); otherwise it reverts with a toast after 3 s.
  const echoed = pending !== null && (stateOf(pending.id).kind === "active") === pending.want;
  if (echoed) setPending(null);
  useEffect(() => {
    if (!pending || echoed) return;
    const left = ECHO_TIMEOUT_MS - (Date.now() - pending.at);
    const timer = setTimeout(() => {
      const s = skills.find((k) => k.id === pending.id);
      notify?.(specString("skill.did_not_respond", { skill: s ? skillDisplayLabel(s, t) : pending.id }));
      setPending(null);
    }, Math.max(0, left));
    return () => clearTimeout(timer);
  }, [pending, echoed, skills, notify, t]);

  const go = useCallback(
    async (skill: Skill) => {
      const ctx = buildSkillContext(droneId);
      if (skill.motion && activeMotion && activeMotion.id !== skill.id) {
        await deactivate(activeMotion.id, ctx);
        const until = Date.now() + PREEMPT_WAIT_MS;
        while (Date.now() < until) {
          if (useSkillRegistry.getState().getState(droneId, activeMotion.id).kind !== "active") break;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      setPending({ id: skill.id, want: true, at: Date.now() });
      await activate(skill.id, ctx);
    },
    [droneId, activeMotion],
  );

  const stop = useCallback(
    async (skill: Skill) => {
      if (stateOf(skill.id).linkLost) {
        setQueuedStop(skill.id);
        notify?.(specString("skill.stop_queued_link", { skill: skillDisplayLabel(skill, t) }));
        return;
      }
      setPending({ id: skill.id, want: false, at: Date.now() });
      await deactivate(skill.id, buildSkillContext(droneId));
    },
    [droneId, stateOf, notify, t],
  );

  // Send a queued Stop once the registry reports the link back.
  useEffect(() => {
    if (queuedStop === null) return;
    const id = queuedStop;
    return useSkillRegistry.subscribe((reg) => {
      const st = reg.getState(droneId, id);
      if (st.linkLost) return;
      setQueuedStop(null);
      if (st.kind !== "active") return;
      setPending({ id, want: false, at: Date.now() });
      void deactivate(id, buildSkillContext(droneId));
    });
  }, [queuedStop, droneId]);

  const sel = selected ? skills.find((s) => s.id === selected) ?? null : null;

  // Controller commands (D-pad focus, Cross GO, Circle Stop, D-pad ↑/↓ on
  // the focused skill's first numeric parameter). Read through a ref so the
  // subscription is made once.
  const manifest = useDronePluginParameters(deviceIdFromNodeId(droneId) ?? droneId);
  const latest = useRef({ open, tab, skills, sel, active, activeMotion, go, stop, droneId, manifest, notify });
  useEffect(() => {
    latest.current = { open, tab, skills, sel, active, activeMotion, go, stop, droneId, manifest, notify };
  });
  useEffect(
    () =>
      onPickerCommand((cmd) => {
        const L = latest.current;
        const list = groupByPlugin(L.skills, L.tab).flatMap(([, g]) => g);
        if (cmd === "focus_next" || cmd === "focus_prev") {
          if (!L.open) setOpen(true);
          if (list.length === 0) return;
          const at = L.sel ? list.findIndex((s) => s.id === L.sel?.id) : -1;
          const step = cmd === "focus_next" ? 1 : -1;
          const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
          setSelected(list[next].id);
        } else if (cmd === "select") {
          if (!L.open) setOpen(true);
          else if (L.sel) void L.go(L.sel);
        } else if (cmd === "stop") {
          const target = L.activeMotion ?? L.active;
          if (target) void L.stop(target);
          else if (L.open) setOpen(false);
        } else if (L.sel) {
          const deviceId = deviceIdFromNodeId(L.droneId) ?? L.droneId;
          const pluginId = L.sel.pluginId ?? "";
          const values = usePluginConfigCache.getState().values[pluginConfigKey(deviceId, pluginId)];
          // The first numeric parameter by its manifest schema, stepped and
          // kept inside its bounds; recorded once the agent accepts it.
          const params = L.manifest.find((p) => p.pluginId === pluginId)?.parameters ?? [];
          const param = params.find(
            (p) => (L.sel?.params ?? []).includes(p.key) && (p.schema.type === "number" || p.schema.type === "integer"),
          );
          if (!param) return;
          const cur = values?.[param.key];
          const base = typeof cur === "number" ? cur : Number(param.schema.default ?? param.schema.minimum ?? 0);
          const value = stepValue(param, base, cmd === "param_up" ? 1 : -1);
          void writePluginConfigValue({ droneId: deviceId, pluginId, key: param.key, value }).then((ok) => {
            if (ok) usePluginConfigCache.getState().record(deviceId, pluginId, param.key, value);
            else L.notify?.(t("plugins.parameters.agentUnreachable"));
          });
        }
      }),
    [setOpen, t],
  );
  useEffect(() => {
    usePickerStore.getState().setOpen(open);
  }, [open]);

  const groups = groupByPlugin(skills, tab);

  return (
    <div className="relative flex flex-col items-end gap-2" data-testid="skill-picker">
      {open && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-label={specString("skill.picker.title")}
          data-testid="skill-picker-sheet"
          className="glass-panel flex max-h-[min(60vh,calc(100vh-var(--fs-bar-b,0px)-120px))] w-[340px] max-w-[92vw] flex-col gap-3 overflow-y-auto p-3"
        >
          <div role="tablist" className="flex gap-1">
            {PICKER_TABS.map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "min-h-12 flex-1 rounded-[var(--fs-radius-sm)] px-2 text-xs font-semibold",
                  tab === k ? "bg-accent-primary/25 text-text-primary" : "text-text-secondary",
                )}
              >
                {specString(`skill.picker.tab.${k}`)}
              </button>
            ))}
          </div>
          {groups.length === 0 && (
            <p className="text-xs text-text-secondary" data-testid="skill-picker-empty">
              {specString("skill.picker.empty")}
            </p>
          )}
          {groups.map(([pid, list]) => (
            <section key={pid} className="flex flex-col gap-1">
              <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                {pid}
              </h4>
              {list.map((s) => {
                const st = stateOf(s.id);
                const seen = lastSeenText(st.seenAt, now);
                return (
                  <button
                    key={s.id}
                    type="button"
                    data-testid={`skill-entry-${s.id}`}
                    onClick={() => setSelected(s.id)}
                    disabled={st.kind === "disabled"}
                    title={st.kind === "disabled" ? st.reason : undefined}
                    data-stale={seen !== null || st.linkLost === true ? "true" : undefined}
                    className={cn(
                      "flex min-h-12 items-center justify-between rounded-[var(--fs-radius-sm)] border px-3 text-left text-sm",
                      selected === s.id ? "border-accent-primary" : "border-border-default",
                      (seen !== null || st.linkLost) && "opacity-60",
                      "disabled:opacity-40",
                    )}
                  >
                    <span>{skillDisplayLabel(s, t)}</span>
                    <span className="flex items-center gap-1 text-[10px] uppercase">
                      {pending?.id === s.id && (
                        <span aria-label="pending" className="h-3 w-3 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
                      )}
                      {queuedStop === s.id && <span>{specString("skill.stop_queued")}</span>}
                      {seen !== null && <span className="normal-case text-text-secondary">{seen}</span>}
                      {st.kind === "active" && (
                        <span style={{ color: SKILL_COLOR }}>
                          {specString(st.linkLost ? "skill.active_stale" : "skill.active")}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
          {sel && (
            <SkillTweakPanel
              droneId={droneId}
              skill={sel}
              active={stateOf(sel.id).kind === "active"}
              starting={pending?.id === sel.id && pending.want}
              onGo={() => void go(sel)}
              onStop={() => void stop(sel)}
              notify={notify}
            />
          )}
        </div>
      )}
      <button
        type="button"
        data-sheet-trigger="skills"
        data-testid="skill-picker-chip"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="glass-pill flex min-h-12 items-center gap-2 rounded-[var(--fs-radius-sm)] px-4 text-[length:var(--fs-chip-px)] font-semibold text-text-primary"
        style={active ? { boxShadow: `inset 0 0 0 2px ${SKILL_COLOR}` } : undefined}
      >
        <Sparkles className="h-[var(--fs-icon)] w-[var(--fs-icon)]" aria-hidden />
        {active ? skillDisplayLabel(active, t) : specString("skill.picker.title")}
      </button>
    </div>
  );
}
