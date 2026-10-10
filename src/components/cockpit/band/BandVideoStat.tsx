"use client";

/**
 * The safety band's video cell: LIVE, FROZEN (the receive path is installed
 * but nothing is arriving), or NO VIDEO, plus the frame age when an estimator
 * can answer. The age always carries its estimator suffix; an unqualified
 * millisecond figure is never shown. A demo node's synthetic feed is the
 * picture the pane shows, so it reads LIVE, from the same predicate the pane
 * renders it from. Its own component so video stats ticks re-render this
 * cell alone.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Video } from "lucide-react";
import { useVideoStore } from "@/stores/video-store";
import { useVideoFrameAge } from "@/hooks/use-video-frame-age";
import { frameAgeLabel } from "@/lib/video/frame-age";
import { useDemoFeedActive } from "../CockpitDemoStream";

export function BandVideoStat({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit.band");
  const demoFeed = useDemoFeedActive(droneId);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const frozen = useVideoStore((s) => s.degradedReason !== null);
  const frameAge = useVideoFrameAge();

  const state = demoFeed ? "live" : !isStreaming ? "none" : frozen ? "frozen" : "live";
  const label =
    state === "live" ? t("videoLive") : state === "frozen" ? t("videoFrozen") : t("videoNone");
  const color =
    state === "live" ? "var(--hud-good)" : state === "frozen" ? "var(--hud-warn)" : "var(--hud-ink-2)";

  return (
    <div className="stat" data-testid="cockpit-video" data-video-state={state}>
      <Video size={12} className="ki" aria-hidden="true" />
      <span className="k">{t("video")}</span>
      <span className="v" style={{ color }}>
        {label}
      </span>
      {state === "live" && !demoFeed && frameAge && (
        <span className="v age" style={{ fontSize: 11, color: "var(--hud-ink-2)" }}>
          {frameAgeLabel(frameAge)}
        </span>
      )}
    </div>
  );
}
