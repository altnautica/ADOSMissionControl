/**
 * One hotbar slot in the Cockpit Skill Bar. A square button that renders a
 * skill's icon, its bound hotkey label, and a state ring (idle / active /
 * cooldown / disabled). Every state carries a redundant non-colour cue so a
 * colour-blind operator distinguishes ready / active / cooldown / disabled by
 * shape and motion, not hue. The slot is a pure view of the registry's derived
 * state — it never asserts a state the drone is not in.
 *
 * @module fly/SkillSlot
 * @license GPL-3.0-only
 */

"use client";

import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { resolveNamedIcon } from "@/lib/icons/icon-registry";
import type { Skill, SkillState } from "@/lib/skills/types";
import { skillDisplayLabel, skillEffectText } from "@/lib/skills/skill-label";
import { formatChord } from "@/lib/skills/chord";

interface SkillSlotProps {
  index: number;
  /** The skill bound to this slot, or null for an empty slot. */
  skill: Skill | null;
  /** The skill's live state (idle fallback for an empty/uncomputed slot). */
  state: SkillState;
  /** The bound keyboard chord, displayed in the corner. */
  hotkey: string | null;
  /** The bound gamepad button index, displayed in the tooltip. */
  gamepadButton: number | null;
  /** Whether this skill is destructive (danger treatment). */
  danger: boolean;
  /** Fire the slot's skill through the dispatcher. */
  onActivate: () => void;
  /**
   * Open this skill's quick settings (a PLUGIN skill only). When present, a
   * long-press / right-click / settings gamepad chord on the slot calls this
   * instead of activating; built-in skills (no settings) leave it undefined and
   * keep activate-only behaviour. The primary tap always activates.
   */
  onOpenSettings?: () => void;
  /**
   * Roving-tabindex value for the toolbar's arrow-key navigation: 0 for the one
   * focusable slot, -1 for the rest. Defaults to 0 when the bar is not managing
   * roving focus.
   */
  tabIndex?: number;
  /** Arrow-key handler so the toolbar can move focus between slots. */
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

/** How long a press is held before it opens settings instead of activating. */
const LONG_PRESS_MS = 500;

export function SkillSlot({
  index,
  skill,
  state,
  hotkey,
  gamepadButton,
  danger,
  onActivate,
  onOpenSettings,
  tabIndex = 0,
  onKeyDown,
}: SkillSlotProps) {
  const t = useTranslations();
  const descId = useId();

  // Long-press detection for the per-skill settings affordance. A pointerdown
  // arms a timer; if it fires before pointerup the press opens settings and the
  // ensuing click is swallowed so the skill does not also activate.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const hasSettings = Boolean(onOpenSettings);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const isDisabled = state.kind === "disabled" || skill === null;
  const isActive = state.kind === "active";
  const isCooldown = state.kind === "cooldown";
  const isToggle = skill?.toggle ?? false;

  // Built-in skill.label is a key root ("skills.arm") with display + effect at
  // "<root>.label"/"<root>.effect"; a plugin skill's label is a literal.
  const label = skill
    ? skillDisplayLabel(skill, t)
    : t("skills.bar.empty", { index: index + 1 });

  const Icon: LucideIcon | null = useMemo(() => {
    if (!skill) return null;
    return resolveNamedIcon(skill.icon);
  }, [skill]);

  const cooldownPct =
    isCooldown && typeof state.progress === "number"
      ? Math.max(0, Math.min(1, state.progress))
      : 0;

  // Charge badge (a small integer string) is surfaced separately so the
  // accessible name can announce the remaining count alongside the state.
  const chargeCount =
    state.badge && /^\d+$/.test(state.badge) ? state.badge : null;

  const stateLabel = useMemo(() => {
    switch (state.kind) {
      case "active":
        return t("skills.state.active");
      case "cooldown": {
        // Surface the remaining seconds so the cooldown is self-describing, not
        // colour/shape-only (the text and the ring tell the same truth).
        // The slot knows the total window from the skill, the fraction from the
        // dispatcher's real clock, so remaining = total * progress.
        const totalMs = skill?.cooldownMs ?? 0;
        const remainingS = Math.max(1, Math.ceil((totalMs * cooldownPct) / 1000));
        return t("skills.state.cooldownRemaining", { seconds: remainingS });
      }
      case "disabled":
        return state.reason
          ? safeReason(t, state.reason)
          : t("skills.state.disabled");
      default:
        return t("skills.state.ready");
    }
  }, [state, t, cooldownPct, skill]);

  const hotkeyLabel = hotkey ? formatChord(hotkey) : null;

  // The state line announced everywhere (accessible name + tooltip + live
  // region) appends the remaining charge count when the skill is charge-bearing,
  // so the badge digit is never a silent visual-only cue.
  const stateWithCharges = chargeCount
    ? t("skills.state.withCharges", { state: stateLabel, charges: chargeCount })
    : stateLabel;

  // Accessible name carries everything the tooltip shows (label + hotkey +
  // state + charges), so nothing is pointer-hover-only.
  const accessibleName = hotkeyLabel
    ? t("skills.bar.slotName", {
        label,
        hotkey: hotkeyLabel,
        state: stateWithCharges,
      })
    : t("skills.bar.slotNameNoKey", { label, state: stateWithCharges });

  // Reason for a disabled slot, surfaced via a hidden description element
  // referenced by aria-describedby so a screen reader announces why the slot
  // is unavailable.
  const ariaDescription =
    isDisabled && skill && state.reason
      ? safeReason(t, state.reason)
      : undefined;

  const tooltipContent = (
    <div className="flex flex-col gap-0.5 text-left">
      <span className="text-text-primary font-medium">{label}</span>
      {skill && skillEffectText(skill, t) ? (
        <span className="text-text-tertiary">{skillEffectText(skill, t)}</span>
      ) : null}
      <span className="text-text-secondary">{stateWithCharges}</span>
      <span className="text-text-tertiary">
        {t("skills.tooltip.hotkey")}: {hotkeyLabel ?? t("skills.tooltip.none")}
        {gamepadButton !== null
          ? ` / ${t("skills.tooltip.gamepad", { button: gamepadButton })}`
          : ""}
      </span>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} position="top">
      <button
        type="button"
        // A disabled slot stays focusable (aria-disabled, not the native
        // disabled attribute) so a keyboard / screen-reader pilot can land on
        // it and hear why it is unavailable; the click is gated below.
        onClick={() => {
          // A long-press just opened settings — swallow the trailing click so
          // the skill does not also activate.
          if (longPressFired.current) {
            longPressFired.current = false;
            return;
          }
          if (isDisabled) return;
          onActivate();
        }}
        // Long-press opens settings (plugin skills only). Disabled slots and
        // built-ins (no onOpenSettings) keep activate-only behaviour; a
        // disabled plugin slot can still open its settings so the operator can
        // adjust it back into a usable state.
        onPointerDown={() => {
          if (!hasSettings) return;
          longPressFired.current = false;
          clearLongPress();
          longPressTimer.current = setTimeout(() => {
            longPressFired.current = true;
            onOpenSettings?.();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearLongPress}
        onPointerLeave={clearLongPress}
        onPointerCancel={clearLongPress}
        // Right-click opens settings for a plugin skill (and suppresses the
        // native context menu); a no-op on built-ins.
        onContextMenu={(e) => {
          if (!hasSettings) return;
          e.preventDefault();
          onOpenSettings?.();
        }}
        onKeyDown={onKeyDown}
        // Roving tabindex: the toolbar keeps exactly one slot tabbable and moves
        // focus with the arrow keys; Enter/Space fire the focused slot natively.
        tabIndex={tabIndex}
        aria-label={accessibleName}
        aria-describedby={ariaDescription ? descId : undefined}
        aria-pressed={isToggle ? isActive : undefined}
        aria-disabled={isDisabled}
        data-skill-id={skill?.id}
        data-slot-index={index}
        className={cn(
          "skill",
          isActive && "active",
          isCooldown && "cool",
          isDisabled && "dis",
        )}
        style={danger && !isDisabled ? { borderColor: "var(--crit)" } : undefined}
      >
        {/* icon */}
        {Icon ? (
          <span className="ic" style={danger ? { color: "var(--crit)" } : undefined}>
            <Icon size={20} />
          </span>
        ) : (
          <span className="ic" style={{ fontSize: 18, lineHeight: 1 }}>
            +
          </span>
        )}

        {/* hotkey label (top-right) */}
        <span className="kbd">{hotkeyLabel ?? index + 1}</span>

        {/* name label (below the slot) */}
        {skill ? <span className="nm">{label}</span> : null}

        {/* cooldown countdown overlay */}
        {isCooldown ? (
          <span className="cd">
            {Math.max(1, Math.ceil(((skill?.cooldownMs ?? 0) * cooldownPct) / 1000))}
          </span>
        ) : null}

        {/* optional state badge (e.g. a locked target id), bottom-right */}
        {state.badge ? (
          <span className="kbd" style={{ top: "auto", bottom: 3, color: "var(--hud)" }}>
            {state.badge}
          </span>
        ) : null}

        {/* hidden reason for assistive tech (the why-disabled line) */}
        {ariaDescription ? (
          <span id={descId} className="sr-only">
            {ariaDescription}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

/**
 * A disabled reason is a fully-qualified i18n key under "skills"
 * (e.g. "skills.reason.noFcLink"). Fall back to the raw string when a plugin
 * supplies a non-key reason so the slot never renders a key.
 */
function safeReason(
  t: ReturnType<typeof useTranslations>,
  reason: string,
): string {
  if (reason.startsWith("skills.")) {
    return t(reason);
  }
  return reason;
}
