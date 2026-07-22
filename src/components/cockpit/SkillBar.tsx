/**
 * The Cockpit Skill Bar: a bottom-center hotbar of the operator's bound
 * skills, each a slot with an icon, hotkey label, and live state ring. The bar
 * is a pure projection of the registry's resolved skills + cached state +
 * the active loadout — it holds no skill logic and asserts no state. A press
 * fires through the single dispatch pipeline so confirm / arm-gating /
 * idempotency are uniform with the keyboard and gamepad paths.
 *
 * Surfaced only when Cockpit is enabled (default off).
 *
 * @module fly/SkillBar
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import {
  safeTranslate,
  useSkillToastBridge,
} from "@/hooks/use-skill-toast-bridge";
import { useDroneStore } from "@/stores/drone-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useCockpitStore } from "@/stores/cockpit-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import {
  useSkillRegistry,
  buildSkillContext,
  activate,
  type Skill,
  type SkillState,
} from "@/lib/skills";
import type { HotbarSlot } from "@/stores/settings/keybindings-slice";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { SkillSlot } from "./SkillSlot";

const IDLE: SkillState = { kind: "idle" };

/** Skills whose press is destructive enough to warrant the danger treatment. */
const DANGER_SKILL_IDS = new Set(["arm", "disarm", "kill", "abort"]);

export function SkillBar() {
  const enabled = useCockpitStore((s) => s.enabled);
  const t = useTranslations();

  // The toast bridge is always wired so any dispatch path (keyboard/gamepad)
  // surfaces feedback even when the bar itself is hidden.
  useSkillToastBridge();

  const selectedId = useDroneStore((s) => s.selectedId);

  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const loadouts = useSettingsStore((s) => s.loadouts);
  const loadout = loadouts[activeLoadoutId] ?? loadouts.default ?? null;

  // Subscribe to the registry so the bar re-renders when skills register/unregister
  // or the per-drone state cache changes.
  const registrySkills = useSkillRegistry((s) => s.skills);
  const registryStates = useSkillRegistry((s) => s.states);
  const resolveForDrone = useSkillRegistry((s) => s.resolveForDrone);

  // The ordered, firmware-/install-filtered skills available for this drone.
  const resolved = useMemo<Skill[]>(() => {
    if (!selectedId) return [];
    return resolveForDrone(selectedId);
    // registrySkills is a dependency so a register/unregister re-resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, resolveForDrone, registrySkills]);

  const resolvedById = useMemo(() => {
    const map = new Map<string, Skill>();
    for (const skill of resolved) map.set(skill.id, skill);
    return map;
  }, [resolved]);

  // Build the projected slot views: bound skill (if available on this drone) +
  // its live state. A slot bound to a skill not available on the selected drone
  // renders empty (the operator's loadout is per-operator; availability is
  // per-drone, 05 §5).
  const slotViews = useMemo(() => {
    const slots: HotbarSlot[] = loadout?.slots ?? [];
    const stateMap = selectedId ? registryStates.get(selectedId) : undefined;
    return slots.map((slot) => {
      const skill = slot.skillId ? resolvedById.get(slot.skillId) ?? null : null;
      const state = skill ? stateMap?.get(skill.id) ?? IDLE : IDLE;
      return { slot, skill, state };
    });
  }, [loadout, resolvedById, registryStates, selectedId]);

  // A polite live region announces active/disabled/cooldown transitions so a
  // screen-reader pilot hears state changes without watching the rings. Charge
  // exhaustion (the last charge spent) is announced too, so the badge digit is
  // never a silent visual-only cue.
  const [announcement, setAnnouncement] = useState("");
  const prevStates = useRef<Map<string, SkillState["kind"]>>(new Map());
  const prevCharges = useRef<Map<string, string | undefined>>(new Map());
  useEffect(() => {
    if (!enabled) return;
    let message = "";
    for (const { skill, state } of slotViews) {
      if (!skill) continue;
      const label = skillDisplayLabel(skill, t);
      const prev = prevStates.current.get(skill.id);
      if (prev !== undefined && prev !== state.kind) {
        if (state.kind === "active") {
          message = t("skills.bar.announceActive", { label });
        } else if (state.kind === "disabled") {
          message = t("skills.bar.announceDisabled", {
            label,
            reason: state.reason
              ? safeTranslate(t, state.reason)
              : t("skills.state.disabled"),
          });
        } else if (state.kind === "cooldown") {
          message = t("skills.bar.announceCooldown", { label });
        } else if (prev === "active" || prev === "cooldown") {
          message = t("skills.bar.announceIdle", { label });
        }
      }
      prevStates.current.set(skill.id, state.kind);

      // Charge transitions: announce when the count changes, with an explicit
      // exhausted message when the last charge is spent.
      const chargeBadge =
        state.badge && /^\d+$/.test(state.badge) ? state.badge : undefined;
      const prevCharge = prevCharges.current.get(skill.id);
      if (
        chargeBadge !== undefined &&
        prevCharge !== undefined &&
        chargeBadge !== prevCharge
      ) {
        message =
          chargeBadge === "0"
            ? t("skills.bar.announceChargesEmpty", { label })
            : t("skills.bar.announceCharges", {
                label,
                charges: chargeBadge,
              });
      }
      prevCharges.current.set(skill.id, chargeBadge);
    }
    if (message) setAnnouncement(message);
  }, [slotViews, enabled, t]);

  if (!enabled || !loadout) return null;

  const fireSlot = (skillId: string | null) => {
    if (!skillId || !selectedId) return;
    void activate(skillId, buildSkillContext(selectedId));
  };

  return (
    <SkillBarToolbar
      slotViews={slotViews}
      fireSlot={fireSlot}
      label={t("skills.bar.label")}
      announcement={announcement}
    />
  );
}

interface SlotView {
  slot: HotbarSlot;
  skill: Skill | null;
  state: SkillState;
}

/**
 * The toolbar shell + roving-tabindex keyboard navigation. Exactly one slot is
 * tabbable; ArrowLeft/Right (and Home/End) move focus between slots, and
 * Enter/Space fire the focused slot natively (the slot is a button). The active
 * roving index follows the last focused slot.
 */
function SkillBarToolbar({
  slotViews,
  fireSlot,
  label,
  announcement,
}: {
  slotViews: SlotView[];
  fireSlot: (skillId: string | null) => void;
  label: string;
  announcement: string;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [rovingIndex, setRovingIndex] = useState(0);

  // The slot set can shrink (a drone with fewer skills), so clamp the roving
  // index during render rather than mutating state in an effect — exactly one
  // slot is tabbable and it is always in range.
  const effectiveRoving =
    slotViews.length > 0
      ? Math.min(rovingIndex, slotViews.length - 1)
      : 0;

  const focusSlotAt = (pos: number) => {
    const clamped = Math.max(0, Math.min(slotViews.length - 1, pos));
    setRovingIndex(clamped);
    const el = toolbarRef.current?.querySelector<HTMLButtonElement>(
      `button[data-slot-index="${slotViews[clamped]?.slot.index}"]`,
    );
    el?.focus();
  };

  const onSlotKeyDown =
    (pos: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          focusSlotAt((pos + 1) % slotViews.length);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          focusSlotAt((pos - 1 + slotViews.length) % slotViews.length);
          break;
        case "Home":
          e.preventDefault();
          focusSlotAt(0);
          break;
        case "End":
          e.preventDefault();
          focusSlotAt(slotViews.length - 1);
          break;
        default:
          break;
      }
    };

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={label}
      className="skillbar pointer-events-auto"
    >
      {slotViews.map(({ slot, skill, state }, pos) => (
        <SkillSlot
          key={slot.index}
          index={slot.index}
          skill={skill}
          state={state}
          hotkey={slot.key}
          gamepadButton={slot.gamepadButton}
          danger={skill ? DANGER_SKILL_IDS.has(skill.id) : false}
          onActivate={() => fireSlot(skill?.id ?? null)}
          tabIndex={pos === effectiveRoving ? 0 : -1}
          onKeyDown={onSlotKeyDown(pos)}
        />
      ))}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
