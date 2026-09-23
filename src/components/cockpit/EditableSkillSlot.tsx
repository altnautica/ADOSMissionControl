/**
 * One editable hotbar slot in the Skill Bar editor. Renders the bound skill (or
 * an empty cell), is a drag source (drag onto another slot to swap, off the bar
 * to clear), a drop target (accept a drawer skill or another slot), and a
 * focusable button that opens the drawer for keyboard binding. Inline controls
 * capture / clear the slot's key chord and gamepad button.
 *
 * The slot never fires a skill — in edit mode the dispatcher is paused; a click
 * focuses the slot so the keyboard binding flow can target it.
 *
 * @module fly/EditableSkillSlot
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { Keyboard, Gamepad2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Skill } from "@/lib/skills";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { formatChord } from "@/lib/skills/chord";
import type { HotbarSlot } from "@/stores/settings/keybindings-slice";
import {
  SKILL_DRAG_TYPE,
  packSkillDrag,
  unpackSkillDrag,
  type SkillDragPayload,
} from "./skill-drag";

interface EditableSkillSlotProps {
  slot: HotbarSlot;
  /** The bound skill resolved for the drone, or null (empty / unavailable). */
  skill: Skill | null;
  /** True when the slot binds a skill not available on the selected drone. */
  unavailable: boolean;
  /** This slot currently has keyboard focus in the editor. */
  focused: boolean;
  /** Capture state for this slot's key / button capture, if active. */
  capturing: "key" | "button" | null;
  onFocusSlot: () => void;
  onDropPayload: (payload: SkillDragPayload) => void;
  onCaptureKey: () => void;
  onCaptureButton: () => void;
  onClearKey: () => void;
  onClearButton: () => void;
}

export function EditableSkillSlot({
  slot,
  skill,
  unavailable,
  focused,
  capturing,
  onFocusSlot,
  onDropPayload,
  onCaptureKey,
  onCaptureButton,
  onClearKey,
  onClearButton,
}: EditableSkillSlotProps) {
  const t = useTranslations("skillBindings");
  const tRoot = useTranslations();

  const label = skill
    ? skillDisplayLabel(skill, tRoot)
    : slot.skillId
      ? slot.skillId
      : t("emptySlot", { index: slot.index + 1 });

  const chordLabel = slot.key ? formatChord(slot.key) : null;

  const accessibleName = t("slotEditName", {
    index: slot.index + 1,
    label,
    key: chordLabel ?? t("noKey"),
    button: slot.gamepadButton !== null ? String(slot.gamepadButton) : t("noButton"),
  });

  return (
    <div
      className={cn(
        "flex w-[120px] shrink-0 flex-col gap-1 border bg-bg-secondary p-1.5",
        focused ? "border-accent-primary" : "border-border-default",
      )}
      onDragOver={(e) => {
        // Only react to our own drag type. The drop effect must be one the
        // source allows: the drawer offers "copy", a slot offers "move", and a
        // mismatch resolves to no operation, so the drop never fires.
        if (e.dataTransfer.types.includes(SKILL_DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect =
            e.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
        }
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(SKILL_DRAG_TYPE);
        const payload = unpackSkillDrag(raw);
        if (!payload) return;
        e.preventDefault();
        onDropPayload(payload);
      }}
    >
      <button
        type="button"
        draggable={Boolean(slot.skillId)}
        onDragStart={(e) => {
          if (!slot.skillId) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData(
            SKILL_DRAG_TYPE,
            packSkillDrag({ kind: "slot", index: slot.index }),
          );
        }}
        onClick={onFocusSlot}
        aria-label={accessibleName}
        aria-current={focused ? "true" : undefined}
        className={cn(
          "flex h-12 items-center justify-center border px-1 text-center text-[11px] leading-tight",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
          slot.skillId
            ? "border-border-default bg-bg-tertiary text-text-primary"
            : "border-dashed border-border-default/60 text-text-tertiary",
          unavailable && "opacity-40",
        )}
      >
        <span className="line-clamp-2">{label}</span>
      </button>

      {unavailable ? (
        <span className="text-[9px] leading-tight text-status-warning">
          {t("unavailableOnDrone")}
        </span>
      ) : null}

      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onCaptureKey}
          aria-label={
            chordLabel
              ? t("rebindKeyFrom", { key: chordLabel })
              : t("captureKey")
          }
          className={cn(
            "flex flex-1 items-center gap-1 border px-1 py-0.5 text-[9px] font-mono",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
            capturing === "key"
              ? "border-accent-primary text-accent-primary motion-safe:animate-pulse"
              : "border-border-default text-text-secondary hover:border-accent-primary",
          )}
        >
          <Keyboard size={10} aria-hidden="true" />
          <span className="truncate">
            {capturing === "key"
              ? t("pressKey")
              : (chordLabel ?? t("noKey"))}
          </span>
        </button>
        {slot.key ? (
          <button
            type="button"
            onClick={onClearKey}
            aria-label={t("clearKey")}
            className="text-text-tertiary hover:text-status-error focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <X size={10} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onCaptureButton}
          aria-label={
            slot.gamepadButton !== null
              ? t("rebindButtonFrom", { button: slot.gamepadButton })
              : t("captureButton")
          }
          className={cn(
            "flex flex-1 items-center gap-1 border px-1 py-0.5 text-[9px] font-mono",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
            capturing === "button"
              ? "border-accent-primary text-accent-primary motion-safe:animate-pulse"
              : "border-border-default text-text-secondary hover:border-accent-primary",
          )}
        >
          <Gamepad2 size={10} aria-hidden="true" />
          <span className="truncate">
            {capturing === "button"
              ? t("pressButton")
              : slot.gamepadButton !== null
                ? t("buttonN", { button: slot.gamepadButton })
                : t("noButton")}
          </span>
        </button>
        {slot.gamepadButton !== null ? (
          <button
            type="button"
            onClick={onClearButton}
            aria-label={t("clearButton")}
            className="text-text-tertiary hover:text-status-error focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <X size={10} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
