"use client";

/**
 * @module vision/DetectorStateTag
 * @description Says why a detection overlay is empty when the drone's detector
 * is not running on the shown camera: the engine reports it idle, refuses the
 * camera, cannot be reached, or the drone has no direct link to ask it over.
 * Shown only while no fresh batch arrives for that camera, so it never sits
 * over live boxes another consumer's lease is producing.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import type { DetectionDemandStatus } from "@/lib/agent/detection-demand";

const COPY: Partial<Record<DetectionDemandStatus, "idle" | "rejected" | "noLink" | "unreachable">> = {
  idle: "idle",
  rejected: "rejected",
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
  return (
    <span
      className="tgt-tag"
      data-tone="muted"
      data-testid="detector-state"
      data-status={status}
      style={{ left: 6, bottom: 6 }}
    >
      {t(key)}
    </span>
  );
}
