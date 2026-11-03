"use client";

/**
 * @module cockpit/FollowSkillPopover
 * @description The follow skill's Skill Bar affordance: a small caret on the
 * follow-me slot that opens a popover with the current follow phase and the
 * STRICT | SMART re-acquire toggle (the same control and pending rule as the
 * right rail).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronUp } from "lucide-react";

import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { PHASE_TONE } from "@/lib/vision/follow-chrome";
import { useFollowingMode } from "@/hooks/use-following-mode";
import { ReacquireModeToggle } from "./ReacquireModeToggle";

export function FollowSkillPopover({ droneId }: { droneId: string }) {
  const t = useTranslations("hud");
  const { follow, stale } = useFollowingMode(droneId);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node | null)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const phase = follow?.phase ?? null;
  const phaseWord = stale && follow ? t("range.stale") : phase ? t(`range.${phase}`) : NO_DATA_GLYPH;
  const phaseColor =
    stale && follow ? "var(--hud-warn)" : phase ? `var(--hud-${PHASE_TONE[phase]})` : "var(--hud-muted)";

  return (
    <div ref={rootRef} className="fskill">
      <button
        type="button"
        className="fskill-caret"
        aria-label={t("followSkill.title")}
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="follow-skill-caret"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronUp size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("followSkill.title")}
          className="fskill-pop glass-panel"
          data-testid="follow-skill-popover"
        >
          <div className="fskill-row">
            <span className="fskill-k">{t("followSkill.phase")}</span>
            <span className="fskill-phase" style={{ color: phaseColor }}>{phaseWord}</span>
          </div>
          <div className="fskill-k">{t("followSkill.reacquire")}</div>
          <ReacquireModeToggle droneId={droneId} echoed={follow?.reacquireMode ?? null} />
          <p className="fskill-hint">{t("followSkill.strictHint")}</p>
          <p className="fskill-hint">{t("followSkill.smartHint")}</p>
        </div>
      )}
    </div>
  );
}
