/**
 * The Cockpit Skill Bar: a bottom-center hotbar of the operator's bound
 * skills, each a slot with an icon, hotkey label, and live state ring. The bar
 * is a pure projection of the registry's resolved skills + cached state +
 * the active loadout — it holds no skill logic and asserts no state. A press
 * fires through the single dispatch pipeline so confirm / arm-gating /
 * idempotency are uniform with the keyboard and gamepad paths.
 *
 * Surfaced while the cockpit's skill layer is enabled (on by default; the
 * operator can turn it off). On a narrow cockpit the slots past the sixth move
 * into an overflow drawer behind a "more" toggle.
 *
 * @module cockpit/SkillBar
 * @license GPL-3.0-only
 */

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { safeTranslate } from "@/hooks/use-skill-toast-bridge";
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
const DANGER_SKILL_IDS: Readonly<Record<string, true>> = {
  arm: true,
  disarm: true,
  kill: true,
  abort: true,
};

/** Slots shown in the bar itself on a narrow cockpit; the rest overflow. */
const NARROW_VISIBLE_SLOTS = 6;

interface SlotView {
  slot: HotbarSlot;
  skill: Skill | null;
  state: SkillState;
}

export function SkillBar({ droneId }: { droneId: string }) {
  const enabled = useCockpitStore((s) => s.enabled);
  const t = useTranslations();

  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const loadouts = useSettingsStore((s) => s.loadouts);
  const loadout = loadouts[activeLoadoutId] ?? loadouts.default ?? null;

  // Subscribe to the registry so the bar re-renders when skills register/unregister
  // or this drone's state cache changes.
  const registrySkills = useSkillRegistry((s) => s.skills);
  const stateMap = useSkillRegistry((s) => s.states.get(droneId));
  const resolveForDrone = useSkillRegistry((s) => s.resolveForDrone);

  // The ordered, firmware-/install-filtered skills available for this drone.
  const resolved = useMemo<Skill[]>(() => {
    if (!droneId) return [];
    return resolveForDrone(droneId);
    // registrySkills is a dependency so a register/unregister re-resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droneId, resolveForDrone, registrySkills]);

  const resolvedById = useMemo(() => {
    const map = new Map<string, Skill>();
    for (const skill of resolved) map.set(skill.id, skill);
    return map;
  }, [resolved]);

  // Build the projected slot views: bound skill (if available on this drone) +
  // its live state. A slot bound to a skill not available on this drone renders
  // empty (the loadout is per-operator; availability is per-drone).
  const slotViews = useMemo<SlotView[]>(() => {
    const slots: HotbarSlot[] = loadout?.slots ?? [];
    return slots.map((slot) => {
      const skill = slot.skillId ? resolvedById.get(slot.skillId) ?? null : null;
      const state = skill ? stateMap?.get(skill.id) ?? IDLE : IDLE;
      return { slot, skill, state };
    });
  }, [loadout, resolvedById, stateMap]);

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

  // Stable across renders so a memoized slot re-renders only when its own
  // skill or state changes.
  const fireSkill = useCallback(
    (skill: Skill) => {
      void activate(skill.id, buildSkillContext(droneId));
    },
    [droneId],
  );

  if (!enabled || !loadout) return null;

  return (
    <SkillBarToolbar
      slotViews={slotViews}
      fireSkill={fireSkill}
      label={t("skills.bar.label")}
      moreLabel={t("skills.bar.more")}
      announcement={announcement}
    />
  );
}

function openSkillSettings(skill: Skill): void {
  if (skill.pluginId) {
    useFlyQuickSettingsStore.getState().openFocused(skill.pluginId);
  }
}

/**
 * The toolbar shell + roving-tabindex keyboard navigation. Exactly one slot is
 * tabbable; ArrowLeft/Right (and Home/End) move focus between slots, and
 * Enter/Space fire the focused slot natively (the slot is a button). The active
 * roving index follows the last focused slot.
 */
function SkillBarToolbar({
  slotViews,
  fireSkill,
  label,
  moreLabel,
  announcement,
}: {
  slotViews: SlotView[];
  fireSkill: (skill: Skill) => void;
  label: string;
  moreLabel: string;
  announcement: string;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [rovingIndex, setRovingIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The slot set can shrink (a drone with fewer skills), so clamp the roving
  // index during render rather than mutating state in an effect — exactly one
  // slot is tabbable and it is always in range.
  const effectiveRoving =
    slotViews.length > 0
      ? Math.min(rovingIndex, slotViews.length - 1)
      : 0;

  const count = slotViews.length;
  const onSlotKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, pos: number) => {
      let next: number | null = null;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = (pos + 1) % count;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = (pos - 1 + count) % count;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = count - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      setRovingIndex(next);
      toolbarRef.current
        ?.querySelectorAll<HTMLButtonElement>("button[data-slot-index]")
        [next]?.focus();
    },
    [count],
  );

  const renderSlot = ({ slot, skill, state }: SlotView, pos: number) => (
    <SkillSlot
      key={slot.index}
      index={slot.index}
      skill={skill}
      state={state}
      hotkey={slot.key}
      gamepadButton={slot.gamepadButton}
      danger={skill ? DANGER_SKILL_IDS[skill.id] === true : false}
      onActivate={fireSkill}
      onOpenSettings={
        skill?.source === "plugin" && skill.pluginId ? openSkillSettings : undefined
      }
      tabIndex={pos === effectiveRoving ? 0 : -1}
      position={pos}
      onKeyDown={onSlotKeyDown}
      overflow={pos >= NARROW_VISIBLE_SLOTS}
    />
  );

  const inline = slotViews.slice(0, NARROW_VISIBLE_SLOTS);
  const overflow = slotViews.slice(NARROW_VISIBLE_SLOTS);

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={label}
      className="skillbar pointer-events-auto"
    >
      {inline.map((view, pos) => renderSlot(view, pos))}
      {overflow.length > 0 && (
        <>
          <div
            id="skillbar-drawer"
            className="skillbar-drawer"
            data-open={drawerOpen ? "true" : "false"}
          >
            {overflow.map((view, i) => renderSlot(view, i + NARROW_VISIBLE_SLOTS))}
          </div>
          <button
            type="button"
            className="skillbar-overflow skill"
            aria-label={moreLabel}
            aria-expanded={drawerOpen}
            aria-controls="skillbar-drawer"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <span className="ic">
              <MoreHorizontal size={20} aria-hidden="true" />
            </span>
          </button>
        </>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
