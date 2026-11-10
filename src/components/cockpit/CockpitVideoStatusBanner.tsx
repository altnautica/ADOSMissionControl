"use client";

/**
 * The PICTURE FROZEN banner, at the top of the flight-flow column: under the
 * top bar (and the follow strip when it is up), between the side columns.
 * The flow overlays stack below it while it shows.
 *
 * Shown while the receive path is still installed and the last decoded frame
 * is still on screen but nothing is arriving: without it a frozen picture
 * reads as a live one. It names the cause and counts up from the moment the
 * feed went bad; the text never flashes.
 *
 * The video store is scoped to the selected drone, so the banner only speaks
 * while this cockpit's drone is the selected one.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useVideoStore, type VideoDegradedReason } from "@/stores/video-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useClockTick } from "@/lib/agent/freshness";
import { useFlightGrid } from "./flight/flight-context";
import { flowColumn } from "./flight/flight-grid";
import { formatElapsed, msSince } from "./band/format";

/** The banner's height; the flow overlays start this far lower while it shows. */
export const FROZEN_BANNER_H = 24;

/** Why this cockpit's picture is frozen, or null while it is live (or not
 * this drone's, or not streaming). */
export function useVideoFrozen(droneId: string): VideoDegradedReason | null {
  const selected = useDroneManager((s) => s.selectedDroneId === droneId);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const reason = useVideoStore((s) => s.degradedReason);
  return selected && isStreaming ? reason : null;
}

export function CockpitVideoStatusBanner({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit.video");
  const grid = useFlightGrid();
  const reason = useVideoFrozen(droneId);
  const since = useVideoStore((s) => s.degradedSince);
  useClockTick();

  if (reason === null) return null;
  const col = flowColumn(grid);

  return (
    <div
      role="status"
      data-testid="cockpit-video-frozen"
      data-video-degraded={reason}
      className="pointer-events-none absolute flex items-center justify-center gap-3 rounded px-3 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{
        left: col.x,
        top: col.y,
        width: col.w,
        height: FROZEN_BANNER_H,
        zIndex: 41,
        color: "var(--hud-ink)",
        background: "color-mix(in oklch, var(--hud-crit) 72%, transparent)",
      }}
    >
      <span>{reason === "ice-disconnect" ? t("frozenLinkLost") : t("frozenNoFrames")}</span>
      {since !== null && <span className="tabular-nums">{formatElapsed(msSince(since))}</span>}
    </div>
  );
}
