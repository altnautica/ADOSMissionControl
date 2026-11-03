/**
 * @module cockpit/cam-swap
 * @description The FRONT ⇄ BELLY swap of the following-mode rail: with two or
 * more concurrent legs, one of them a downward (`down`) camera, swap the main
 * video and the PiP legs. With no PiP showing, the other leg is the belly
 * camera when the main is not it, else the first other concurrent leg.
 *
 * @license GPL-3.0-only
 */

import type { StreamDescriptor } from "@/stores/video-streams-store";

export interface CamSwapPlan {
  /** The leg that becomes the main video. */
  main: StreamDescriptor;
  /** The leg that moves into the PiP. */
  pip: StreamDescriptor;
}

/** The swap the rail would perform, or null when the button is not offered. */
export function camSwapPlan(
  streams: readonly StreamDescriptor[],
  activeId: string | null | undefined,
  pipId: string | null | undefined,
): CamSwapPlan | null {
  const legs = streams.filter((s) => s.kind === "concurrent" && s.live !== false);
  if (legs.length < 2 || !legs.some((s) => s.role === "down")) return null;
  const current = legs.find((s) => s.id === activeId) ?? legs[0];
  if (!current) return null;
  const others = legs.filter((s) => s.id !== current.id);
  const next =
    others.find((s) => s.id === pipId) ??
    (current.role !== "down" ? others.find((s) => s.role === "down") : undefined) ??
    others[0];
  return next ? { main: next, pip: current } : null;
}
