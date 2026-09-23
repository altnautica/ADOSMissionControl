/**
 * The single confirm host for the skill dispatch pipeline. Subscribes to the
 * skill-confirm store and renders the shared ConfirmDialog for a pending
 * ConfirmPolicy, resolving the dispatcher's awaited promise on confirm/cancel.
 *
 * Replicates the two safety flows the action panel uses today: the Kill
 * two-stage dialog with a 3s countdown before its typed phrase enables, and
 * the checklist-aware OVERRIDE escalation that records a safety override when
 * the pre-flight checklist is incomplete. Mounts once, alongside the other
 * shell-wide bridges.
 *
 * @module fly/SkillConfirmHost
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useChecklistStore, checklistReadyFor } from "@/stores/checklist-store";

const OVERRIDE_LOG_KEY = "ados:flight-safety-overrides";

/**
 * Append a best-effort local audit row when an operator overrides an
 * incomplete checklist. Mirrors the action-dialogs recorder exactly so both
 * surfaces write the same trail. Never throws — an audit failure must not
 * block a command.
 */
function recordSafetyOverride(action: string, reason: string): void {
  try {
    const existing = JSON.parse(
      localStorage.getItem(OVERRIDE_LOG_KEY) ?? "[]",
    ) as unknown;
    const rows = Array.isArray(existing) ? existing : [];
    rows.push({ action, reason, at: new Date().toISOString() });
    localStorage.setItem(OVERRIDE_LOG_KEY, JSON.stringify(rows.slice(-100)));
  } catch {
    // Local audit trail is best-effort and must never block a command.
  }
}

/** Translate a key, falling back to the raw string for non-key content. */
function tr(
  t: ReturnType<typeof useTranslations>,
  value: string,
  values?: Record<string, string | number>,
): string {
  if (value.startsWith("skills.") || value.includes(".")) {
    try {
      return t(value, values);
    } catch {
      return value;
    }
  }
  return value;
}

export function SkillConfirmHost() {
  const t = useTranslations();
  const pending = useSkillConfirmStore((s) => s.pending);
  const resolvePending = useSkillConfirmStore((s) => s.resolvePending);

  // Readiness for the drone the request targets: a checklist completed for any
  // other aircraft, or a request that names no drone, does not count.
  const targetDroneId = pending?.droneId ?? null;
  const checklistReady = useChecklistStore((s) => checklistReadyFor(s, targetDroneId));

  // Kill two-stage state. The two-stage state is keyed to the pending request
  // id so a fresh request starts at the first dialog with a full countdown,
  // without a reset effect that would trigger a cascading render.
  const requestId = pending?.id ?? null;
  const [killStage, setKillStage] = useState<{ id: number | null; final: boolean }>(
    { id: null, final: false },
  );
  const [killCountdown, setKillCountdown] = useState(3);
  const showKillFinal = killStage.id === requestId && killStage.final;

  const policy = pending?.policy ?? null;

  // The countdown only runs while the final kill dialog is open.
  useEffect(() => {
    if (!showKillFinal) return;
    if (killCountdown <= 0) return;
    const timer = setTimeout(() => setKillCountdown(killCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [showKillFinal, killCountdown]);

  // Whether the active policy escalates to the OVERRIDE phrase (checklist-aware
  // and the live checklist is incomplete).
  const escalated = Boolean(policy?.checklistAware) && !checklistReady;

  const derivedAction = useMemo(() => {
    // Derive the audit action from the confirm title key (e.g.
    // "skills.arm.confirm.title" -> "arm"). Used only for the override log.
    const title = policy?.title ?? "";
    const match = title.match(/^skills\.([^.]+)\.confirm\./);
    return match ? match[1] : "skill";
  }, [policy?.title]);

  if (!policy) return null;

  const isTwoStage = typeof policy.twoStageCountdownSeconds === "number";

  // ── Two-stage (Kill) ──────────────────────────────────────────────────
  if (isTwoStage) {
    const countdownSeconds = policy.twoStageCountdownSeconds ?? 3;
    return (
      <>
        <ConfirmDialog
          open={!showKillFinal}
          onCancel={() => resolvePending(false)}
          onConfirm={() => {
            setKillCountdown(countdownSeconds);
            if (requestId !== null) {
              setKillStage({ id: requestId, final: true });
            }
          }}
          title={tr(t, policy.title, policy.values)}
          message={tr(t, policy.message, policy.values)}
          confirmLabel={tr(t, policy.confirmLabel)}
          variant={policy.variant}
        />
        <ConfirmDialog
          open={showKillFinal}
          onCancel={() => resolvePending(false)}
          onConfirm={() => resolvePending(true)}
          title={t("skills.kill.finalTitle")}
          message={`${t("skills.kill.finalMessage")} ${
            killCountdown > 0
              ? t("skills.kill.finalWait", { seconds: killCountdown })
              : t("skills.kill.finalEnabled")
          }`}
          confirmLabel={
            killCountdown > 0
              ? t("skills.kill.finalWait", { seconds: killCountdown })
              : t("skills.kill.finalButton")
          }
          variant="danger"
          confirmDisabled={killCountdown > 0}
          typedPhrase={killCountdown > 0 ? undefined : policy.typedPhrase}
        />
      </>
    );
  }

  // ── Standard single-dialog (with optional checklist-aware OVERRIDE) ────
  const title = escalated
    ? t("skills.override.title", { title: tr(t, policy.title, policy.values) })
    : tr(t, policy.title, policy.values);
  const message = escalated
    ? t("skills.override.message")
    : tr(t, policy.message, policy.values);
  const typedPhrase = escalated ? "OVERRIDE" : policy.typedPhrase;

  return (
    <ConfirmDialog
      open
      onCancel={() => resolvePending(false)}
      onConfirm={() => {
        if (escalated) recordSafetyOverride(derivedAction, "preflight_incomplete");
        resolvePending(true);
      }}
      title={title}
      message={message}
      confirmLabel={tr(t, policy.confirmLabel)}
      variant={policy.variant}
      typedPhrase={typedPhrase}
    />
  );
}
