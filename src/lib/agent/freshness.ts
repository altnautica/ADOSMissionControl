/**
 * @module freshness
 * @description Single source of truth for agent heartbeat freshness. Every
 * Command-tab widget that shows agent-sourced data should consume `useFreshness()`
 * so thresholds stay in sync and "last seen" labels count up in real time.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useClockStore, subscribeToClock } from "@/stores/clock-store";

/** Heartbeat considered stale after this many ms without an update. */
export const STALE_THRESHOLD_MS = 30_000;

/** Heartbeat considered offline (agent presumed dead) after this many ms. */
export const OFFLINE_THRESHOLD_MS = 120_000;

export type FreshnessState = "live" | "stale" | "offline" | "unknown";

export interface Freshness {
  state: FreshnessState;
  elapsedMs: number;
  /** Human-readable "Xs ago" / "Xm Ys ago" label, or "—" when unknown. */
  label: string;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem === 0 ? `${m}m ago` : `${m}m ${rem}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export function getFreshness(lastUpdatedAt: number | null): Freshness {
  if (lastUpdatedAt == null) {
    return { state: "unknown", elapsedMs: 0, label: "—" };
  }
  const elapsedMs = Date.now() - lastUpdatedAt;
  let state: FreshnessState;
  if (elapsedMs < STALE_THRESHOLD_MS) state = "live";
  else if (elapsedMs < OFFLINE_THRESHOLD_MS) state = "stale";
  else state = "offline";
  return { state, elapsedMs, label: formatElapsed(elapsedMs) };
}

/**
 * React hook that returns the current freshness of the agent system store.
 * Subscribes to a shared 1Hz clock store so "last seen Xs ago" labels count
 * up in lockstep across every consumer on the page, with only one interval
 * running process-wide (refcounted — starts on first subscription, stops on
 * last unmount).
 */
export function useFreshness(): Freshness {
  const lastUpdatedAt = useAgentSystemStore((s) => s.lastUpdatedAt);
  // Subscribe to the clock tick so this component re-renders every second.
  // The selector returns a scalar so Zustand bails out when nothing changed.
  useClockStore((s) => s.tick);

  useEffect(() => subscribeToClock(), []);

  return getFreshness(lastUpdatedAt);
}

/**
 * Subscribe to the shared 1Hz clock without reading freshness. Used by
 * components like FleetSidebar that derive their state from `Date.now()`
 * against per-row timestamps and need periodic re-renders to keep their
 * "live/stale/offline" dots current.
 */
export function useClockTick(): number {
  const tick = useClockStore((s) => s.tick);
  useEffect(() => subscribeToClock(), []);
  return tick;
}
