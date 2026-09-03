/**
 * The Cockpit gamepad radial quick-select overlay. While a reserved gamepad
 * button is held, the active loadout's bound skills fan out as wedges around
 * the screen center; the right stick or d-pad highlights one, and releasing the
 * hold button fires it through the shared dispatcher (see use-gamepad-radial).
 *
 * Kiosk-friendly: an HDMI operator with only a stick reaches every bound skill
 * with no pointer. The overlay is a pure projection of the radial model — it
 * holds no skill logic and asserts no state; each wedge's ring reflects the
 * registry's derived state for the selected drone (idle / active / disabled),
 * so a disabled skill reads disabled and an active toggle reads active, never
 * an optimistic state.
 *
 * Accessibility: the overlay is a labelled live region announcing the
 * highlighted skill; each wedge carries a non-colour state cue (the lock glyph
 * for disabled, the latched dot for active, the highlight ring for the
 * selection) so a colour-blind operator distinguishes states by shape, and the
 * highlight pulse respects prefers-reduced-motion.
 *
 * @module fly/SkillRadial
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDroneManager } from "@/stores/drone-manager";
import { useSkillRegistry, type SkillState } from "@/lib/skills";
import { resolveSkillIcon } from "@/lib/skills/skill-icon";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { useGamepadRadial } from "@/hooks/use-gamepad-radial";

const IDLE: SkillState = { kind: "idle" };

/** Radius of the wedge ring as a fraction of the overlay's smaller dimension. */
const RING_RADIUS_VMIN = 26;

interface SkillRadialProps {
  /** The path is live only while Cockpit is on and no modal owns input. */
  enabled: boolean;
}

export function SkillRadial({ enabled }: SkillRadialProps) {
  const t = useTranslations();
  const { open, wedges, highlightedIndex } = useGamepadRadial(enabled);

  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const registryStates = useSkillRegistry((s) => s.states);

  const stateMap = selectedId ? registryStates.get(selectedId) : undefined;

  const highlightedLabel = useMemo(() => {
    const w = highlightedIndex >= 0 ? wedges[highlightedIndex] : undefined;
    return w ? skillDisplayLabel(w.skill, t) : "";
  }, [highlightedIndex, wedges, t]);

  if (!enabled || !open || wedges.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-bg-primary/40 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="false"
      aria-label={t("skills.radial.label")}
    >
      {/* Center hint: the highlighted skill name, or a "release to fire" prompt. */}
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="panel rounded-lg px-3 py-1 text-sm font-semibold text-[#eaf1fc]">
          {highlightedLabel || t("skills.radial.aimPrompt")}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-text-tertiary">
          {t("skills.radial.releaseToFire")}
        </span>
      </div>

      {wedges.map((wedge, i) => {
        const state = stateMap?.get(wedge.skill.id) ?? IDLE;
        const isHighlighted = i === highlightedIndex;
        const isDisabled = state.kind === "disabled";
        const isActive = state.kind === "active";
        const Icon = resolveSkillIcon(wedge.skill.icon);
        const label = skillDisplayLabel(wedge.skill, t);

        // Place the wedge on the ring: 0 rad = up, clockwise.
        const x = Math.sin(wedge.angle) * RING_RADIUS_VMIN;
        const y = -Math.cos(wedge.angle) * RING_RADIUS_VMIN;

        return (
          <div
            key={wedge.skill.id}
            className="absolute left-1/2 top-1/2"
            style={{
              transform: `translate(calc(-50% + ${x}vmin), calc(-50% + ${y}vmin))`,
            }}
          >
            <div
              aria-hidden="true"
              className={cn(
                "panel relative flex h-16 w-16 items-center justify-center rounded-xl transition-all",
                isActive &&
                  "border-[#37d99a] bg-[rgba(55,217,154,0.12)] shadow-[0_0_14px_rgba(55,217,154,0.28)]",
                isDisabled && "opacity-40",
                isHighlighted &&
                  "border-[#63b3ff] ring-2 ring-[#63b3ff] shadow-[0_0_16px_rgba(99,179,255,0.5)] motion-safe:animate-pulse",
              )}
            >
              <Icon
                size={22}
                className={cn(
                  isActive ? "text-[#37d99a]" : "text-[#eaf1fc]",
                  isDisabled && "text-text-tertiary",
                )}
              />
              {/* Active latched dot (non-colour cue). */}
              {isActive ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#37d99a]" />
              ) : null}
              {/* Disabled lock glyph (non-colour cue). */}
              {isDisabled ? (
                <Lock
                  size={10}
                  className="absolute right-1 top-1 text-text-tertiary"
                />
              ) : null}
            </div>
            {/* Wedge label below the glyph. */}
            <span
              aria-hidden="true"
              className={cn(
                "mt-1 block max-w-[8rem] truncate text-center text-[10px] leading-tight",
                isHighlighted ? "text-accent-primary" : "text-text-secondary",
              )}
            >
              {label}
            </span>
          </div>
        );
      })}

      {/* Live region: announces the highlighted skill to a screen reader. */}
      <span className="sr-only" role="status" aria-live="polite">
        {highlightedLabel
          ? t("skills.radial.highlighted", { label: highlightedLabel })
          : t("skills.radial.aimPrompt")}
      </span>
    </div>
  );
}
