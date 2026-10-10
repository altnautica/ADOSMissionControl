"use client";

/**
 * @module cockpit/CockpitTopRight
 * @description The top-right cockpit cluster: the density segmented control
 * (Min / Std / Full), the live video stats (resolution · fps · frame age),
 * and a camera pill.
 *
 * The camera pill names the node's primary (streaming) camera from the agent
 * capability probe, never a fabricated "main" label. When the node
 * advertises no camera roster the pill is omitted rather than inventing one;
 * when it advertises more than one, a `+N` hint points at the roster PiP. On a
 * multi-stream node the top-left stream switcher already names the active
 * stream, so the pill is omitted there to avoid a duplicate indicator.
 *
 * ## The latency figure
 *
 * Network RTT plus decoder buffer wait is typically 10-30 ms on a path whose
 * real camera-to-monitor delay is around 200 ms. The cluster therefore leads
 * with the FRAME AGE from `useVideoFrameAge`, always suffixed with the
 * estimator that produced it and `—` when neither can answer, and labels the
 * network roll-up `net` so it cannot be misread as end-to-end.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useVideoStore } from "@/stores/video-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { useVideoFrameAge } from "@/hooks/use-video-frame-age";
import { frameAgeLabel } from "@/lib/video/frame-age";
import type { CockpitDensity } from "@/lib/cockpit/density";
import { useDemoFeedActive } from "./CockpitDemoStream";

const MODES: { id: CockpitDensity; key: "densityMin" | "densityStd" | "densityFull" }[] = [
  { id: "minimal", key: "densityMin" },
  { id: "standard", key: "densityStd" },
  { id: "full", key: "densityFull" },
];

interface Props {
  density: CockpitDensity;
  onDensity: (d: CockpitDensity) => void;
  /** The cockpit's drone, so the pill can defer to the stream switcher on a
   * multi-stream node. Absent = never a multi-stream node (the pill shows). */
  droneId?: string;
}

export function CockpitTopRight({ density, onDensity, droneId }: Props) {
  const t = useTranslations("cockpit.topRight");
  const tBand = useTranslations("cockpit.band");
  const demoFeed = useDemoFeedActive(droneId);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);
  const degradedReason = useVideoStore((s) => s.degradedReason);
  const frameAge = useVideoFrameAge();
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const streamCount = useVideoStreamsStore((s) =>
    droneId ? (s.streamsByDrone[droneId]?.length ?? 0) : 0,
  );

  // The primary camera = the first streaming one, else the first advertised.
  const active =
    streamCount > 1
      ? null
      : (cameras.find((c) => c.streaming === true) ?? cameras[0] ?? null);
  const extra = cameras.length > 1 ? cameras.length - 1 : 0;

  return (
    <div className="zone tr">
      <div className="seg" role="group" aria-label={t("densityGroup")}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={density === m.id}
            onClick={() => onDensity(m.id)}
          >
            {t(m.key)}
          </button>
        ))}
      </div>

      <div className="vstats panel d-std">
        {demoFeed ? (
          // The synthetic demo feed is playing; it has no stream statistics.
          <span className="s">{tBand("videoLive")}</span>
        ) : isStreaming ? (
          <>
            <span className="s">
              <b>{resolution || "—"}</b>
            </span>
            <span className="s">
              <b>{fps === null ? "—" : Math.round(fps)}</b>
              {t("fps")}
            </span>
            <span
              className="s"
              data-frame-age-source={frameAge?.source ?? "unknown"}
              title={
                frameAge?.source === "sei-g2g"
                  ? t("frameAgeSeiTitle")
                  : frameAge?.source === "frame-metadata"
                    ? t("frameAgeMetadataTitle")
                    : t("frameAgeUnknownTitle")
              }
            >
              {t("video")} <b>{frameAge ? `+${frameAgeLabel(frameAge)}` : "—"}</b>
            </span>
            <span className="s" title={t("netTitle")}>
              <b>{latencyMs === null ? "—" : Math.round(latencyMs)}</b>
              {t("msNet")}
            </span>
            {degradedReason && (
              <span className="s" data-video-degraded={degradedReason}>
                <b>{degradedReason === "ice-disconnect" ? t("linkLost") : t("noFrames")}</b>
              </span>
            )}
          </>
        ) : (
          <span className="s">{t("offline")}</span>
        )}
      </div>

      {active && (
        <div
          className={`camsel panel d-std${active.streaming === false ? " idle" : ""}`}
          data-camera-streaming={active.streaming}
        >
          <i className="dot" />
          <span title={active.name}>{t("camera", { name: active.name })}</span>
          {extra > 0 && <span className="more">+{extra}</span>}
        </div>
      )}
    </div>
  );
}
