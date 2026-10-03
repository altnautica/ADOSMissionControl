"use client";

// Stick-control opt-in for the kiosk HUD. The HUD opens the manual-control
// stream on mount, but the stream only transmits once the operator opts in,
// and that opt-in otherwise lives on the input settings page the shell-less
// kiosk never shows. This is the same store flag: it is off at every start,
// needs a connected gamepad, and is revoked when the pad drops.

import { useInputStore } from "@/stores/input-store";
import { cn } from "@/lib/utils";

export function StickControlToggle({ className }: { className?: string }) {
  const hasGamepad = useInputStore((s) => s.activeController === "gamepad");
  const enabled = useInputStore((s) => s.manualControlEnabled);
  const setEnabled = useInputStore((s) => s.setManualControlEnabled);
  const linkBlock = useInputStore((s) => s.manualControlLinkBlock);

  return (
    <div className={cn("pointer-events-auto flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={!hasGamepad}
        onClick={() => setEnabled(!enabled)}
        className={cn(
          "text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border",
          enabled
            ? "bg-status-warning/30 text-status-warning border-status-warning/60"
            : "bg-scrim/50 text-on-media/80 border-on-media/30",
          !hasGamepad && "opacity-40 cursor-not-allowed",
        )}
      >
        {enabled ? "Stick control on" : "Enable stick control"}
      </button>
      {enabled && linkBlock ? (
        <div
          role="status"
          className="max-w-[16rem] text-right text-[10px] font-mono px-2 py-1 bg-scrim/50 text-status-warning rounded"
        >
          {linkBlock}
        </div>
      ) : null}
    </div>
  );
}
