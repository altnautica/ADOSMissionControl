"use client";

/**
 * Top-of-shell banner that reflects the SLCAN session state machine.
 *
 * Renders nothing in IDLE. The mounted variants are:
 *   - ENTERING_SLCAN  -> blue, "Entering SLCAN..." + spinner
 *   - SLCAN_ACTIVE    -> amber, the FC's idle-revert watchdog + Resume button
 *   - EXITING_SLCAN   -> blue, "Exiting SLCAN..." + spinner
 *   - RECONNECTING_MAVLINK -> blue, "Reconnecting MAVLink..." + spinner
 *   - ERROR           -> red, error text + Dismiss
 *
 * The FC's CAN_SLCAN_TIMOUT reverts the port only after that many seconds
 * with no SLCAN traffic, so the banner states the idle window rather than
 * counting down to a deadline that a busy flash never reaches.
 *
 * @module components/shared/SlcanModeBanner
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { Loader2, ShieldAlert, X } from "lucide-react";
import {
  useSlcanModeStore,
  type SlcanModeSnapshot,
} from "@/stores/slcan-mode-store";

function selectSnapshot(s: SlcanModeSnapshot): SlcanModeSnapshot {
  return s;
}

export function SlcanModeBanner(): React.ReactElement | null {
  const snapshot = useSlcanModeStore(selectSnapshot);
  const reset = useSlcanModeStore((s) => s.reset);
  const [resuming, setResuming] = useState(false);

  if (snapshot.state === "IDLE") return null;

  if (snapshot.state === "ERROR") {
    return (
      <div
        role="alert"
        data-testid="slcan-banner-error"
        className="flex items-center justify-between gap-3 px-4 py-2 bg-status-error/10 border-b border-status-error/40 text-status-error text-[11px]"
      >
        <div className="flex items-center gap-2">
          <ShieldAlert size={12} />
          <span>{snapshot.errorMessage ?? "SLCAN error"}</span>
        </div>
        <button
          onClick={reset}
          className="px-2 py-0.5 text-[10px] border border-status-error/40 hover:bg-status-error/20 cursor-pointer flex items-center gap-1"
        >
          <X size={10} />
          Dismiss
        </button>
      </div>
    );
  }

  if (snapshot.state === "SLCAN_ACTIVE") {
    const timeoutSec = snapshot.timeoutSec;
    const exitFn = snapshot.exitFn;
    const handleResume = async () => {
      if (!exitFn || resuming) return;
      setResuming(true);
      try {
        await exitFn();
      } catch {
        // The arbiter pushes a markError into the store on failure; the
        // banner will flip to the ERROR variant on the next snapshot.
      } finally {
        setResuming(false);
      }
    };
    return (
      <div
        role="status"
        data-testid="slcan-banner-active"
        className="flex items-center justify-between gap-3 px-4 py-2 bg-status-warning/10 border-b border-status-warning/40 text-status-warning text-[11px]"
      >
        <span>
          SLCAN active on CAN{snapshot.bus}
          {timeoutSec != null && timeoutSec > 0
            ? ` — FC reverts to MAVLink after ${timeoutSec} s idle`
            : ""}
        </span>
        {exitFn ? (
          <button
            type="button"
            data-testid="slcan-banner-resume"
            onClick={handleResume}
            disabled={resuming}
            className="px-2 py-0.5 text-[10px] border border-status-warning/40 hover:bg-status-warning/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1"
          >
            {resuming && <Loader2 size={10} className="animate-spin" />}
            Resume MAVLink
          </button>
        ) : (
          <span className="text-[10px] text-text-tertiary">
            Resume MAVLink when the flash completes.
          </span>
        )}
      </div>
    );
  }

  // ENTERING / EXITING / RECONNECTING all share the blue spinner variant.
  const transitionLabels: Record<
    "ENTERING_SLCAN" | "EXITING_SLCAN" | "RECONNECTING_MAVLINK",
    string
  > = {
    ENTERING_SLCAN: "Entering SLCAN mode...",
    EXITING_SLCAN: "Exiting SLCAN mode...",
    RECONNECTING_MAVLINK: "Reconnecting MAVLink...",
  };
  return (
    <div
      role="status"
      data-testid="slcan-banner-transition"
      className="flex items-center gap-2 px-4 py-2 bg-accent-primary/10 border-b border-accent-primary/40 text-accent-primary text-[11px]"
    >
      <Loader2 size={12} className="animate-spin" />
      <span>{transitionLabels[snapshot.state]}</span>
    </div>
  );
}
