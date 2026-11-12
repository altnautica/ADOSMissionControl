"use client";

/**
 * @module vision/DetectorStateTag
 * @description Says why a detection overlay is empty when the drone's detector
 * is not running on the shown camera: the engine reports it idle, refuses the
 * camera, refuses the pairing key, cannot be reached, or the drone has no
 * direct link to ask it over.
 * Shown only while no fresh batch arrives for that camera, so it never sits
 * over live boxes another consumer's lease is producing.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import type { DetectionDemandStatus } from "@/lib/agent/detection-demand";
import { specString } from "@/lib/cockpit/spec-strings";

const COPY: Partial<
  Record<DetectionDemandStatus, "idle" | "rejected" | "unauthorized" | "noLink" | "unreachable">
> = {
  idle: "idle",
  rejected: "rejected",
  unauthorized: "unauthorized",
  "no-link": "noLink",
  error: "unreachable",
};

export function DetectorStateTag({
  status,
  show,
}: {
  status: DetectionDemandStatus | null;
  /** False while a fresh batch for the shown camera arrives (or the layer
   * draws nothing at all). */
  show: boolean;
}) {
  const t = useTranslations("hud.detector");
  const key = status ? COPY[status] : undefined;
  if (!show || !key) return null;
  // Idle and unreachable have shared spec words; the pairing and link
  // causes are this app's own.
  const text = key === "idle" ? specString("detector.idle") : key === "unreachable" ? specString("detector.unavailable") : t(key);
  return (
    <span
      className="tgt-tag"
      data-tone="muted"
      data-testid="detector-state"
      data-status={status}
      style={{ left: 6, bottom: 6 }}
    >
      {text}
    </span>
  );
}
