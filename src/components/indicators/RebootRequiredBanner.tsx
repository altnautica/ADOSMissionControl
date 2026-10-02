"use client";

import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { cn } from "@/lib/utils";
import { RotateCcw, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * The FC's boot clock (SYSTEM_TIME.time_boot_ms) going back by more than this
 * is a reboot. A link dropout pauses the samples but never rewinds the clock.
 */
const BOOT_CLOCK_REWIND_MS = 1000;
/** How long the banner stays up after the reboot is seen, before fading. */
const CLEAR_DELAY_MS = 3000;
const FADE_MS = 400;

/**
 * Amber banner shown when parameter changes require a FC reboot.
 * Tracks params with rebootRequired metadata flag.
 *
 * When the FC's boot clock restarts (it rebooted), the banner fades out and
 * the pending reboot params are cleared. Dismissing hides only the current
 * set: a later change that also needs a reboot shows the banner again. The
 * Reboot action is refused while armed, confirmed first, and its result shown.
 */
export function RebootRequiredBanner({
  rebootParams,
  className,
}: {
  /** List of param names that need a reboot to take effect */
  rebootParams: string[];
  className?: string;
}) {
  const t = useTranslations("fcShared");
  const paramsKey = rebootParams.join(",");
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rebootResult, setRebootResult] = useState<string | null>(null);
  const protocol = useDroneManager((s) => s.getSelectedProtocol());
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const clearTimerRef = useRef<number | null>(null);
  const pending = rebootParams.length > 0;

  // Detect a reboot from the FC's boot clock restarting.
  useEffect(() => {
    if (!pending || !protocol?.onSystemTime) return;
    let prevBootMs: number | null = null;
    return protocol.onSystemTime(({ timeBootMs }) => {
      const prev = prevBootMs;
      prevBootMs = timeBootMs;
      if (prev === null || timeBootMs >= prev - BOOT_CLOCK_REWIND_MS) return;
      if (clearTimerRef.current !== null) return;
      // The timer lives in a ref so the next sample does not cancel it.
      clearTimerRef.current = window.setTimeout(() => {
        setFadingOut(true);
        clearTimerRef.current = window.setTimeout(() => {
          clearTimerRef.current = null;
          setFadingOut(false);
          setRebootResult(null);
          useParamSafetyStore.getState().clearRebootParams();
        }, FADE_MS);
      }, CLEAR_DELAY_MS);
    });
  }, [protocol, pending]);

  useEffect(
    () => () => {
      window.clearTimeout(clearTimerRef.current ?? undefined);
    },
    [],
  );

  if (!pending || dismissedKey === paramsKey) return null;

  async function handleReboot() {
    setConfirmOpen(false);
    if (!protocol) return;
    const result = await protocol.reboot();
    setRebootResult(
      !result.success
        ? `Reboot refused: ${result.message}`
        : result.acknowledged === false
          ? "Reboot sent; waiting for the flight controller to restart"
          : "Reboot accepted; waiting for the flight controller to restart",
    );
  }

  return (
    <div
      className={cn(
        "mx-3 mb-2 rounded border border-status-warning/50 bg-status-warning/10 px-3 py-2 text-xs transition-all",
        className,
      )}
      style={fadingOut ? { animation: "fade-out-down 0.4s ease-out forwards" } : undefined}
    >
      <div className="flex items-center gap-2">
        <RotateCcw size={14} className="text-status-warning shrink-0" />
        <span className="flex-1 text-text-primary">
          {t("rebootRequired")}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmOpen(true)}
          disabled={!protocol || isHardBlocked}
          title={hardBlockMessage || undefined}
        >
          {t("rebootNow")}
        </Button>
        <button
          onClick={() => setDismissedKey(paramsKey)}
          aria-label="Dismiss"
          className="text-text-tertiary hover:text-text-primary"
        >
          <X size={12} />
        </button>
      </div>
      <div className="mt-1 text-[10px] font-mono text-text-tertiary">
        {rebootParams.join(", ")}
      </div>
      {rebootResult && (
        <div className="mt-1 text-[10px] text-text-secondary">{rebootResult}</div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onConfirm={() => { void handleReboot(); }}
        onCancel={() => setConfirmOpen(false)}
        title="Reboot flight controller"
        message="The flight controller restarts and the link drops until it is back. Continue?"
        confirmLabel="Reboot"
        variant="danger"
      />
    </div>
  );
}
