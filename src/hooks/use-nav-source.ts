"use client";

/**
 * @module use-nav-source
 * @description Everything the nav-source chip (and any other surface that
 * reports what the EKF navigates on) resolves from: the latest
 * EKF_STATUS_REPORT flags and their age, the latest GPS fix, Navigation
 * `nav.state` while fresh, the set this GCS last commanded, the
 * EK3_SRC* parameters, and the fresh pilot state's `position_unverified`.
 * Re-renders on throttled telemetry and on the shared 1 Hz clock so a report
 * that stops arriving goes stale on screen.
 *
 * @license GPL-3.0-only
 */

import type { NavState } from "@/lib/hud/nav-types";
import { useClockTick } from "@/lib/agent/freshness";
import { EKF_STALE_MS, resolveNavSource, type NavSourceResult } from "@/lib/hud/nav-source";
import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { useThrottledTelemetryVersion } from "@/hooks/use-throttled-telemetry-version";
import { useNavStateEntry } from "@/hooks/use-nav-feed";
import { useEkfSourceParams } from "@/hooks/use-ekf-source-params";
import { useEkfSourceStore } from "@/stores/ekf-source-store";
import { NAV_STATE_STALE_MS, freshData, useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

export interface NavSourceGps {
  fixType: number;
  satellites?: number;
  hdop?: number;
}

export interface NavSourceView {
  result: NavSourceResult;
  params: Readonly<Record<string, number>> | null;
  /** Navigation state while fresh (≤ 2 s), else null. */
  nav: NavState | null;
  gps: NavSourceGps | null;
  /** Latest EKF flags, or null when no report has arrived. */
  ekfFlags: number | null;
}

export function useNavSource(droneId: string | null | undefined): NavSourceView {
  useThrottledTelemetryVersion();
  useClockTick();

  const navEntry = useNavStateEntry(droneId);
  const params = useEkfSourceParams(droneId);
  const lastCommanded = useEkfSourceStore((s) =>
    droneId ? s.lastCommanded[droneId] ?? null : null,
  );
  const pilot = useNavStreamStore((s) => (droneId ? s.byDrone[droneId]?.pilot : undefined));

  // Read the ring tails each render: the result depends on wall-clock age.
  const buffers = useTelemetryStore.getState();
  const ekfSample = buffers.ekf.latest();
  const gpsSample = buffers.gps.latest();
  const now = Date.now();

  const nav = freshData(navEntry ?? undefined, now, NAV_STATE_STALE_MS);
  // A GPS sample older than the EKF window is no fix at all, never a remembered one.
  const gps: NavSourceGps | null =
    gpsSample && now - gpsSample.timestamp <= EKF_STALE_MS
      ? { fixType: gpsSample.fixType, satellites: gpsSample.satellites, hdop: gpsSample.hdop }
      : null;
  const ekf = ekfSample
    ? { flags: ekfSample.flags, ageMs: Math.max(0, now - ekfSample.timestamp) }
    : null;

  // Only a fresh pilot vouches for (or against) the position.
  const positionUnverified = pilot && pilotFresh(pilot.receivedAt, now) ? pilot.data.positionUnverified : null;
  const result = resolveNavSource({ ekf, gps, nav, lastCommandedSet: lastCommanded, params, positionUnverified });
  return { result, params, nav, gps, ekfFlags: ekfSample?.flags ?? null };
}
