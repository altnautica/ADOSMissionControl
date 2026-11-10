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
 * carries the altitude stepper whose value is what gets commanded. Sheet text
 * is the shared spec's (`confirm.*`) wherever the spec names it, and a command
 * going out over a stale link says the vehicle may not receive it.
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
import { checklistReadyFor, useChecklistStore } from "@/stores/checklist-store";
import { cn } from "@/lib/utils";
import { useConfirmHold } from "./use-confirm-hold";
import { HoldControl } from "./HoldControl";
import { SlideToConfirm } from "./SlideToConfirm";
import { AltitudeStepper } from "./AltitudeStepper";
import { recordSafetyOverride, translatePolicyText } from "./confirm-text";
import { specString } from "@/lib/cockpit/spec-strings";
import { BELOW_TOP_BAR, closeFlightSheets, useFlightRoot } from "../flight/flight-sheet";
import { createPortal } from "react-dom";
import { StopSheet } from "./StopSheet";

interface ConfirmSheetProps {
  policy: ConfirmPolicy;
  droneId: string | null;
  onResolve: (confirmed: boolean, choice?: ConfirmChoice) => void;
}

export function ConfirmSheet({ policy, droneId, onResolve }: ConfirmSheetProps) {
  const t = useTranslations();
  const holdMs = confirmHoldMs(policy);
  // The first-arm gate: the spec pre-flight checklist passed for the drone
  // this request targets. A checklist run for another aircraft vouches for
  // nothing here. The list names the spec items not yet passing.
  const ready = useChecklistStore((s) => checklistReadyFor(s, droneId));
  const preflightDroneId = useChecklistStore((s) => s.droneId);
  const preflight = useChecklistStore((s) => s.preflight);
  const openItems = useMemo(
    () => (preflightDroneId === droneId && preflight ? preflight.filter((i) => i.state !== "pass") : []),
    [preflightDroneId, preflight, droneId],
  );
  const checklistIncomplete = Boolean(policy.checklistAware) && !ready;
  const [override, setOverride] = useState(false);
  const gestureEnabled = !checklistIncomplete || override;

  const [altitudeM, setAltitudeM] = useState(policy.altitude?.defaultM ?? 0);

  // On the flight screen the emergency stop has its own sheet (no guard window).
  const flightRoot = useFlightRoot();
  const stopSheet = flightRoot !== null && policy.gesture === "guarded";

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
      // The action from a built-in's spec title (`confirm.<key>.title`, keyed
      // in `lib/skills/builtins/_shared.ts`) or an app skill's (`skills.<id>.confirm.title`).
      const m = /^(?:confirm\.([^.]+)|skills\.([^.]+)\.confirm)\./.exec(policy.title);
      const action = m?.[1] ?? m?.[2] ?? "skill";
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
    if (policy.gesture !== "guarded" || hold.holding || stopSheet) return;
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
  }, [policy.gesture, hold.holding, guardEndsAt, resolve, stopSheet]);

  // A guarded hold counts down the time left to cut the motors.
  const [holdLeftMs, setHoldLeftMs] = useState(holdMs);
  useEffect(() => {
    if (policy.gesture !== "guarded" || !hold.holding) return;
    const started = Date.now();
    const tick = setInterval(() => {
      setHoldLeftMs(Math.max(0, holdMs - (Date.now() - started)));
    }, 100);
    return () => {
      clearInterval(tick);
      setHoldLeftMs(holdMs);
    };
  }, [policy.gesture, hold.holding, holdMs]);

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

  // On the flight screen the dialog sits below the top bar over a
  // translucent scrim, so the picture stays visible and STOP keeps the first
  // press; it replaces any open flight-screen sheet.
  useEffect(() => {
    if (flightRoot) closeFlightSheets();
  }, [flightRoot]);

  if (stopSheet && flightRoot) {
    const stop = <StopSheet hold={hold} holdMs={holdMs} holdLeftMs={holdLeftMs} sheetRef={sheetRef} onCancel={() => resolve(false)} staleLink={policy.staleLink === true} />;
    return createPortal(stop, flightRoot);
  }

  const dialog = (
    <div
      data-flight-confirm=""
      data-testid="confirm-scrim"
      style={flightRoot ? BELOW_TOP_BAR : undefined}
      className={cn(
        "z-50 flex items-end justify-center p-4 sm:items-center",
        flightRoot ? "overflow-y-auto bg-scrim/50" : "fixed inset-0 bg-scrim",
      )}
    >
      <div
        ref={sheetRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="skill-confirm-title"
        aria-describedby="skill-confirm-message"
        data-gesture={policy.gesture}
        className={cn(
          "flex max-h-full w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-xl border bg-bg-secondary p-4 shadow-xl",
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
            aria-label={specString("setup.action.cancel")}
            className="rounded-md p-1 text-text-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p id="skill-confirm-message" className="text-sm text-text-secondary">
          {message}
        </p>

        {policy.staleLink && (
          <p
            role="alert"
            className="flex items-center gap-1.5 rounded-md border border-status-warning/60 bg-status-warning/10 p-2 text-xs font-semibold text-status-warning"
          >
            <ShieldAlert size={14} aria-hidden="true" />
            {specString("confirm.stale_link")}
          </p>
        )}

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
              {specString("confirm.checklist_failing")}
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
              {specString("confirm.override")}
            </label>
            <p className="text-[11px] text-text-tertiary">
              {specString("confirm.override_hint")}
            </p>
          </div>
        )}

        {policy.gesture === "guarded" && (
          <p role="status" className="text-xs font-semibold text-status-error">
            {hold.holding
              ? specString("confirm.guard_holding", { s: (holdLeftMs / 1000).toFixed(1) })
              : specString("confirm.guard", { s: guardSeconds })}
          </p>
        )}

        {policy.gesture === "slide" ? (
          <SlideToConfirm
            hold={hold}
            holdMs={holdMs}
            label={confirmLabel}
            hint={specString("confirm.slide_hint", { s: (holdMs / 1000).toFixed(1) })}
            disabled={!gestureEnabled}
            onComplete={complete}
          />
        ) : (
          <HoldControl
            hold={hold}
            holdMs={holdMs}
            label={confirmLabel}
            hint={specString("confirm.hold", { s: (holdMs / 1000).toFixed(1) })}
            danger={danger}
            disabled={!gestureEnabled}
          />
        )}
        <p className="text-[11px] text-text-tertiary">{specString("confirm.input_hint")}</p>

        <button
          type="button"
          onClick={() => resolve(false)}
          className="h-10 rounded-md border border-border-default text-sm text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          {specString("setup.action.cancel")}
        </button>
      </div>
    </div>
  );
  return flightRoot ? createPortal(dialog, flightRoot) : dialog;
}
