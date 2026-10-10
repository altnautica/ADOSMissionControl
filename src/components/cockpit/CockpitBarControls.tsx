"use client";

/**
 * @module cockpit/CockpitBarControls
 * @description The Skill Bar's side controls: command palette, quick settings
 * and the bar editor. Shown while the skill layer is on.
 * @license GPL-3.0-only
 */

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Command, Settings2, SlidersHorizontal } from "lucide-react";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";

const CONTROL_CLASS =
  "glass-pill flex h-9 w-9 items-center justify-center self-center text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary";

function openPalette(): void {
  useSkillInputStore.getState().setPaletteOpen(true);
}

function openEditor(): void {
  useSkillInputStore.getState().setEditorOpen(true);
}

function toggleQuickSettings(): void {
  useFlyQuickSettingsStore.getState().toggle();
}

export const CockpitBarControls = memo(function CockpitBarControls() {
  const t = useTranslations("skillBindings");
  const tPalette = useTranslations("commandPalette");
  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-label={tPalette("open")}
        title={`${tPalette("open")} (Ctrl/⌘ K)`}
        className={CONTROL_CLASS}
      >
        <Command size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={toggleQuickSettings}
        aria-label={t("openQuickSettings")}
        title={t("openQuickSettings")}
        className={CONTROL_CLASS}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={openEditor}
        aria-label={t("editBar")}
        className={CONTROL_CLASS}
      >
        <Settings2 size={16} aria-hidden="true" />
      </button>
    </>
  );
});
