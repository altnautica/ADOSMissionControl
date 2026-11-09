"use client";

/**
 * @module cockpit/flight/CameraSheet
 * @description Camera settings: the stream switcher (multi-stream nodes), the
 * camera roster and the live video figures (resolution, frame rate, frame age
 * with the estimator that produced it, and the network round trip labelled
 * `net` so it is never read as end-to-end delay).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { useVideoStore } from "@/stores/video-store";
import { useVideoFrameAge } from "@/hooks/use-video-frame-age";
import { frameAgeLabel } from "@/lib/video/frame-age";
import { CockpitCameraRoster } from "@/components/vision/CockpitCameraRoster";
import { CockpitStreamTabs } from "../CockpitStreamTabs";
import { useDemoFeedActive } from "../CockpitDemoStream";

function VideoFigures({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit.topRight");
  const tc = useTranslations("flightScreen.camera");
  const demoFeed = useDemoFeedActive(droneId);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);
  const frameAge = useVideoFrameAge();
  if (demoFeed) return <p className="fs-figures">{tc("demoFeed")}</p>;
  if (!isStreaming) return <p className="fs-figures">{tc("offline")}</p>;
  return (
    <p className="fs-figures" data-testid="fs-video-figures">
      <span>{resolution || "—"}</span>
      <span>
        {fps === null ? "—" : Math.round(fps)} {t("fps")}
      </span>
      <span data-frame-age-source={frameAge?.source ?? "unknown"}>
        {t("video")} {frameAge ? `+${frameAgeLabel(frameAge)}` : "—"}
      </span>
      <span title={t("netTitle")}>
        {latencyMs === null ? "—" : Math.round(latencyMs)}
        {t("msNet")}
      </span>
    </p>
  );
}

/** The camera controls without a frame, for the Menu and the sheet. */
export function CameraPanel({ droneId }: { droneId: string }) {
  return (
    <div className="fs-camera" data-testid="fs-camera-panel">
      <CockpitStreamTabs droneId={droneId} />
      <CockpitCameraRoster />
      <VideoFigures droneId={droneId} />
    </div>
  );
}

export function CameraSheet({ droneId, onClose }: { droneId: string; onClose: () => void }) {
  const t = useTranslations("flightScreen.camera");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest("[data-testid='fs-camera-settings']")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" aria-label={t("settings")} className="fs-sheet fs-camera-sheet" data-testid="fs-camera-sheet">
      <CameraPanel droneId={droneId} />
    </div>
  );
}
