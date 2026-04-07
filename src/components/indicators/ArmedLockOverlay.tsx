"use client";

import { useArmedLock } from "@/hooks/use-armed-lock";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Panel wrapper used across all FC configure panels.
 *
 * Previously this rendered a full blocking overlay when armed, preventing
 * users from even seeing their options. The new behavior:
 *
 * - Children always render and stay fully interactive.
 * - When the vehicle is armed, a non-blocking warning banner pins to the
 *   top of the panel scroll area.
 * - The actual write guard happens at save time via
 *   `usePanelParams.saveAllToRam()` which opens a confirmation dialog.
 *
 * The name is preserved so the 23 existing panel imports keep working
 * without touching every file.
 */
export function ArmedLockOverlay({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { isArmed, lockMessage } = useArmedLock();

  return (
    <div className={cn("relative flex-1 flex flex-col min-h-0", className)}>
      {isArmed && (
        <div className="shrink-0 flex items-center gap-2 mx-3 mt-2 mb-1 rounded border border-status-warning/50 bg-status-warning/10 px-3 py-2 text-xs">
          <ShieldAlert size={14} className="text-status-warning shrink-0" />
          <span className="text-status-warning">{lockMessage}</span>
        </div>
      )}
      {children}
    </div>
  );
}
