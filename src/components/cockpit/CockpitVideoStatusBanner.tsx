"use client";

/**
 * The PICTURE FROZEN banner, directly under the safety band.
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
import { useVideoStore } from "@/stores/video-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useClockTick } from "@/lib/agent/freshness";
import { formatElapsed, msSince } from "./band/format";

export function CockpitVideoStatusBanner({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit.video");
  const selected = useDroneManager((s) => s.selectedDroneId === droneId);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const reason = useVideoStore((s) => s.degradedReason);
  const since = useVideoStore((s) => s.degradedSince);
  useClockTick();

  if (!selected || !isStreaming || reason === null) return null;

  return (
    <div
      role="status"
      data-testid="cockpit-video-frozen"
      data-video-degraded={reason}
      className="pointer-events-none absolute inset-x-0 flex items-center justify-center gap-3 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider"
      style={{
        top: 40,
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
