"use client";

/**
 * Battery warning / critical threshold inputs. Each field edits a string
 * draft and commits on blur, so typing a multi-digit value is never clamped
 * mid-keystroke. A committed value is clamped to its range, and critical must
 * stay strictly below warning or the edit is refused with an inline error.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settings-store";

const WARNING_RANGE = { min: 10, max: 50 } as const;
const CRITICAL_RANGE = { min: 5, max: 30 } as const;

function parseClamped(draft: string, range: { min: number; max: number }): number | null {
  if (draft.trim() === "") return null;
  const n = Math.round(Number(draft));
  if (!Number.isFinite(n)) return null;
  return Math.max(range.min, Math.min(range.max, n));
}

export function BatteryThresholdFields() {
  const t = useTranslations("notifications");
  const warningPct = useSettingsStore((s) => s.batteryWarningPct);
  const criticalPct = useSettingsStore((s) => s.batteryCriticalPct);
  const setWarningPct = useSettingsStore((s) => s.setBatteryWarningPct);
  const setCriticalPct = useSettingsStore((s) => s.setBatteryCriticalPct);

  // `null` = not editing; the field shows the stored value.
  const [warningDraft, setWarningDraft] = useState<string | null>(null);
  const [criticalDraft, setCriticalDraft] = useState<string | null>(null);
  const [error, setError] = useState<"warning" | "critical" | null>(null);

  const commitWarning = () => {
    if (warningDraft === null) return;
    const v = parseClamped(warningDraft, WARNING_RANGE);
    if (v === null) {
      setWarningDraft(null);
      return;
    }
    if (v <= criticalPct) {
      setError("warning");
      return;
    }
    setError(null);
    setWarningPct(v);
    setWarningDraft(null);
  };

  const commitCritical = () => {
    if (criticalDraft === null) return;
    const v = parseClamped(criticalDraft, CRITICAL_RANGE);
    if (v === null) {
      setCriticalDraft(null);
      return;
    }
    if (v >= warningPct) {
      setError("critical");
      return;
    }
    setError(null);
    setCriticalPct(v);
    setCriticalDraft(null);
  };

  return (
    <>
      <Input
        label={t("batteryWarning")}
        type="number"
        min={WARNING_RANGE.min}
        max={WARNING_RANGE.max}
        value={warningDraft ?? String(warningPct)}
        onChange={(e) => setWarningDraft(e.target.value)}
        onBlur={commitWarning}
        error={error === "warning" ? t("criticalBelowWarning") : undefined}
        unit="%"
      />
      <Input
        label={t("batteryCritical")}
        type="number"
        min={CRITICAL_RANGE.min}
        max={CRITICAL_RANGE.max}
        value={criticalDraft ?? String(criticalPct)}
        onChange={(e) => setCriticalDraft(e.target.value)}
        onBlur={commitCritical}
        error={error === "critical" ? t("criticalBelowWarning") : undefined}
        unit="%"
      />
    </>
  );
}
