/**
 * @module NavStatePill
 * @description Compact pill showing the iNav navigation state and active action.
 * Renders only when the selected drone firmware is iNav and nav state data is available.
 * @license GPL-3.0-only
 */
"use client";

import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneManager } from "@/stores/drone-manager";
import { Tooltip } from "@/components/ui/tooltip";
import { useClockTick } from "@/lib/agent/freshness";
import { isFresh } from "@/lib/telemetry/freshness";
import {
  inavNavActionLabel,
  inavNavModeLabel,
  inavNavStateLabel,
} from "@/lib/protocol/msp/inav-nav-status";

// ── Component ────────────────────────────────────────────────

export function NavStatePill() {
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const protocol = getProtocol();
  const firmwareType = protocol?.getVehicleInfo()?.firmwareType;

  const navMode = useTelemetryStore((s) => s.navMode);
  const navState = useTelemetryStore((s) => s.navState);
  const navAction = useTelemetryStore((s) => s.navAction);
  const updatedAt = useTelemetryStore((s) => s.navStatusUpdated);
  // Re-render as time passes so a nav status that stops arriving hides.
  useClockTick();

  if (firmwareType !== "inav" || navState === null) return null;
  // A stale MSP_NAV_STATUS says nothing about what navigation is doing now.
  if (!isFresh(updatedAt, Date.now())) return null;

  const isActive = navState > 0 || (navMode !== null && navMode > 0);
  const showAction = navAction !== null && navAction > 0;

  const modeLabel = navMode !== null ? inavNavModeLabel(navMode) : null;
  const stateLabel = inavNavStateLabel(navState);
  const actionLabel = navAction !== null ? inavNavActionLabel(navAction) : "";

  const parts = [
    modeLabel !== null ? `Nav mode: ${modeLabel}` : null,
    `Nav state: ${stateLabel}`,
    showAction ? `Nav action: ${actionLabel}` : null,
  ].filter((p): p is string => p !== null);
  const tooltipText = parts.join(", ");

  return (
    <Tooltip content={tooltipText}>
      <div
        role="status"
        aria-label={`iNav navigation state: ${tooltipText}`}
        className={
        "flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border " +
        (isActive
          ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
          : "bg-bg-tertiary border-border-default text-text-secondary")
      }>
        <span>{stateLabel}</span>
        {showAction && (
          <>
            <span className="text-text-tertiary">/</span>
            <span>{actionLabel}</span>
          </>
        )}
      </div>
    </Tooltip>
  );
}
