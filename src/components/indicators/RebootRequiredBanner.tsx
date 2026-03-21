"use client";

import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { cn } from "@/lib/utils";
import { RotateCcw, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * Amber banner shown when parameter changes require a FC reboot.
 * Tracks params with rebootRequired metadata flag.
 * Auto-dismisses 3s after a reboot is detected (heartbeat resumes after gap).
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
  const [dismissed, setDismissed] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const protocol = useDroneManager.getState().getSelectedProtocol();
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const prevHeartbeatRef = useRef(lastHeartbeat);
  const rebootDetectedRef = useRef(false);

  // Detect reboot: heartbeat gap > 2s then resume
  useEffect(() => {
    if (dismissed || rebootParams.length === 0) return;

    const prev = prevHeartbeatRef.current;
    prevHeartbeatRef.current = lastHeartbeat;

    if (prev === 0 || lastHeartbeat === 0) return;

    const gap = lastHeartbeat - prev;

    // If there was a gap > 2s and heartbeat resumed, it's a reboot
    if (gap > 2000 && !rebootDetectedRef.current) {
      rebootDetectedRef.current = true;
      // Wait 3s then fade out
      const timer = setTimeout(() => {
        setFadingOut(true);
        // After fade animation, dismiss
        const fadeTimer = setTimeout(() => setDismissed(true), 400);
        return () => clearTimeout(fadeTimer);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [lastHeartbeat, dismissed, rebootParams.length]);

  if (dismissed || rebootParams.length === 0) return null;

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
        <button onClick={() => setDismissed(true)} className="text-text-tertiary hover:text-text-primary">
          <X size={12} />
        </button>
      </div>
      <div className="mt-1 text-[10px] font-mono text-text-tertiary">
        {rebootParams.join(", ")}
      </div>
    </div>
  );
}
