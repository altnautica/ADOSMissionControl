"use client";

/**
 * @module cockpit/confirm/ConfirmSheet
 * @description One skill confirmation, rendered for one pending request. The
 * policy's gesture decides the control: `hold` is a press-and-hold, `slide` a
 * slide-to-confirm, `guarded` (kill) opens with its guard armed for a short
 * window inside which a hold fires — the guard lapsing cancels the request.
 * Every tier is also satisfied by holding Enter or the gamepad button that
 * opened the request, so a pilot never has to let go of the controller.
 *
 * A checklist-aware request whose pre-flight checklist is incomplete lists the
 * open items and keeps the gesture inert until the operator turns on the
 * explicit override, which is recorded as a safety event. A take-off sheet
 * carries the altitude stepper whose value is what gets commanded.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert, X } from "lucide-react";
import {
  GUARD_WINDOW_MS,
  confirmHoldMs,
  type ConfirmChoice,
  type ConfirmPolicy,
} from "@/lib/skills/types";
import { useChecklistStore } from "@/stores/checklist-store";
import { cn } from "@/lib/utils";
import { useConfirmHold } from "./use-confirm-hold";
import { HoldControl } from "./HoldControl";
import { SlideToConfirm } from "./SlideToConfirm";
import { AltitudeStepper } from "./AltitudeStepper";
import { recordSafetyOverride, translatePolicyText } from "./confirm-text";

interface ConfirmSheetProps {
  policy: ConfirmPolicy;
  droneId: string | null;
  onResolve: (confirmed: boolean, choice?: ConfirmChoice) => void;
}

export function ConfirmSheet({ policy, droneId, onResolve }: ConfirmSheetProps) {
  const t = useTranslations();
  const holdMs = confirmHoldMs(policy);
  // Open checklist items for the drone this request targets. A checklist run
  // for another aircraft vouches for nothing here.
  const checklistDroneId = useChecklistStore((s) => s.droneId);
  const checklistItems = useChecklistStore((s) => s.items);
  const openItems = useMemo(
    () =>
      checklistDroneId === droneId
        ? checklistItems.filter((i) => i.status === "pending" || i.status === "fail")
        : checklistItems,
    [checklistDroneId, checklistItems, droneId],
  );
  const checklistIncomplete = Boolean(policy.checklistAware) && openItems.length > 0;
  const [override, setOverride] = useState(false);
  const gestureEnabled = !checklistIncomplete || override;

  const [altitudeM, setAltitudeM] = useState(policy.altitude?.defaultM ?? 0);

  // Guarded tier: the window opens with the sheet.
  const [guardEndsAt] = useState(() => Date.now() + GUARD_WINDOW_MS);
  const [guardSeconds, setGuardSeconds] = useState(Math.ceil(GUARD_WINDOW_MS / 1000));

  const resolved = useRef(false);
  const resolve = useCallback(
    (confirmed: boolean, choice?: ConfirmChoice) => {
      if (resolved.current) return;
      resolved.current = true;
      onResolve(confirmed, choice);
    },
    [onResolve],
  );

  const complete = useCallback(() => {
    if (checklistIncomplete) {
      const action = /^skills\.([^.]+)\.confirm\./.exec(policy.title)?.[1] ?? "skill";
      recordSafetyOverride(action, "preflight_incomplete");
    }
    resolve(true, policy.altitude ? { altitudeM } : undefined);
  }, [checklistIncomplete, policy.title, policy.altitude, altitudeM, resolve]);

  const hold = useConfirmHold({
    holdMs,
    enabled: gestureEnabled,
    gamepadButton: policy.gamepadButton,
    onComplete: complete,
  });

  // The guard lapses unless a hold is running when its window closes; a hold
  // started inside the window is allowed to finish.
  useEffect(() => {
    if (policy.gesture !== "guarded" || hold.holding) return;
    const remaining = guardEndsAt - Date.now();
    if (remaining <= 0) {
      resolve(false);
      return;
    }
    const lapse = setTimeout(() => resolve(false), remaining);
    const tick = setInterval(() => {
      setGuardSeconds(Math.max(0, Math.ceil((guardEndsAt - Date.now()) / 1000)));
    }, 250);
    return () => {
      clearTimeout(lapse);
      clearInterval(tick);
    };
  }, [policy.gesture, hold.holding, guardEndsAt, resolve]);

  // Escape cancels; the gesture control takes focus so Enter is a hold at once.
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current
      ?.querySelector<HTMLElement>("[data-hold-control='true']")
      ?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolve(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [resolve]);

  const values = policy.altitude
    ? { ...policy.values, altitude: altitudeM }
    : policy.values;
  const title = translatePolicyText(t, policy.title, values);
  const message = translatePolicyText(t, policy.message, values);
  const confirmLabel = translatePolicyText(t, policy.confirmLabel, values);
  const danger = policy.variant === "danger" || policy.gesture === "guarded";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 sm:items-center">
      <div
        ref={sheetRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="skill-confirm-title"
        aria-describedby="skill-confirm-message"
        data-gesture={policy.gesture}
        className={cn(
          "flex w-full max-w-sm flex-col gap-3 rounded-xl border bg-bg-secondary p-4 shadow-xl",
          danger ? "border-status-error/70" : "border-border-strong",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="skill-confirm-title" className="text-base font-semibold text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => resolve(false)}
            aria-label={t("cockpit.confirm.cancel")}
            className="rounded-md p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p id="skill-confirm-message" className="text-sm text-text-secondary">
          {message}
        </p>

        {policy.altitude && (
          <AltitudeStepper
            spec={policy.altitude}
            value={altitudeM}
            onChange={setAltitudeM}
          />
        )}

        {checklistIncomplete && (
          <div className="flex flex-col gap-2 rounded-md border border-status-warning/60 bg-status-warning/10 p-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-status-warning">
              <ShieldAlert size={14} aria-hidden="true" />
              {t("cockpit.confirm.checklistIncomplete", { count: openItems.length })}
            </p>
            <ul className="max-h-28 list-disc overflow-y-auto pl-5 text-[11px] text-text-secondary">
              {openItems.map((item) => (
                <li key={item.id}>{item.label}</li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-xs text-text-primary">
              <input
                type="checkbox"
                role="switch"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
                className="h-4 w-4 accent-[var(--color-status-warning)]"
              />
              {t("cockpit.confirm.checklistOverride")}
            </label>
            <p className="text-[11px] text-text-tertiary">
              {t("cockpit.confirm.checklistOverrideHint")}
            </p>
          </div>
        )}

        {policy.gesture === "guarded" && (
          <p role="status" className="text-xs font-semibold text-status-error">
            {hold.holding
              ? t("cockpit.confirm.guardHolding")
              : t("cockpit.confirm.guardArmed", { seconds: guardSeconds })}
          </p>
        )}

        {policy.gesture === "slide" ? (
          <SlideToConfirm
            hold={hold}
            holdMs={holdMs}
            label={confirmLabel}
            hint={t("cockpit.confirm.slideHint")}
            disabled={!gestureEnabled}
            onComplete={complete}
          />
        ) : (
          <HoldControl
            hold={hold}
            holdMs={holdMs}
            label={confirmLabel}
            hint={t("cockpit.confirm.holdHint", { seconds: (holdMs / 1000).toFixed(1) })}
            danger={danger}
            disabled={!gestureEnabled}
          />
        )}

        <button
          type="button"
          onClick={() => resolve(false)}
          className="h-10 rounded-md border border-border-default text-sm text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          {t("cockpit.confirm.cancel")}
        </button>
      </div>
    </div>
  );
}
