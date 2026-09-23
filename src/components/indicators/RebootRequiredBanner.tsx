"use client";

import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { cn } from "@/lib/utils";
import { RotateCcw, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/** A heartbeat gap longer than this, followed by a resumed heartbeat, is a reboot. */
const REBOOT_GAP_MS = 2000;
/** How long the banner stays up after the reboot is seen, before fading. */
const CLEAR_DELAY_MS = 3000;
const FADE_MS = 400;

/**
 * Amber banner shown when parameter changes require a FC reboot.
 * Tracks params with rebootRequired metadata flag.
 *
 * When the heartbeat resumes after a gap (the FC rebooted), the banner fades
 * out and the pending reboot params are cleared. Dismissing hides only the
 * current set: a later change that also needs a reboot shows the banner again.
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
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const prevHeartbeatRef = useRef(lastHeartbeat);
  const clearTimerRef = useRef<number | null>(null);

  // Detect reboot: heartbeat gap then resume. The previous heartbeat is
  // tracked on every beat, so a gap is only ever measured between two
  // consecutive heartbeats.
  useEffect(() => {
    const prev = prevHeartbeatRef.current;
    prevHeartbeatRef.current = lastHeartbeat;
    if (rebootParams.length === 0 || clearTimerRef.current !== null) return;
    if (prev === 0 || lastHeartbeat === 0) return;
    if (lastHeartbeat - prev <= REBOOT_GAP_MS) return;

    // The timer lives in a ref so the next heartbeat does not cancel it.
    clearTimerRef.current = window.setTimeout(() => {
      setFadingOut(true);
      clearTimerRef.current = window.setTimeout(() => {
        clearTimerRef.current = null;
        setFadingOut(false);
        useParamSafetyStore.getState().clearRebootParams();
      }, FADE_MS);
    }, CLEAR_DELAY_MS);
  }, [lastHeartbeat, rebootParams.length]);

  useEffect(
    () => () => {
      window.clearTimeout(clearTimerRef.current ?? undefined);
    },
    [],
  );

  if (rebootParams.length === 0 || dismissedKey === paramsKey) return null;

  async function handleReboot() {
    if (!protocol) return;
    await protocol.reboot();
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
        <Button size="sm" variant="ghost" onClick={handleReboot}>
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
    </div>
  );
}
