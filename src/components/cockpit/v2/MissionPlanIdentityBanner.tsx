"use client";

/**
 * @module cockpit/v2/MissionPlanIdentityBanner
 * @description On every map view: when the plan on the drone is not the
 * plan this device uploaded, say so and offer to load the drone's plan (the
 * maps then draw the agent's mirror of it). The rule is in
 * `lib/mission/plan-identity`.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";

import { useDronePlanIdentity } from "@/lib/mission/mission-mirror";
import { cn } from "@/lib/utils";
import { useMissionStore } from "@/stores/mission-store";

export function MissionPlanIdentityBanner({ droneId, className }: { droneId: string; className?: string }) {
  const identity = useDronePlanIdentity(droneId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (identity !== "differs") return null;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await useMissionStore.getState().downloadMission();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The download failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="status"
      data-testid="plan-identity-banner"
      className={cn(
        "glass-panel pointer-events-auto flex items-center gap-3 px-3 py-2 text-xs text-text-primary",
        className,
      )}
    >
      <span>Plan on drone differs from this device&apos;s plan</span>
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="rounded bg-accent-primary/20 px-2 py-1 font-semibold text-accent-primary hover:bg-accent-primary/30 disabled:opacity-50"
      >
        {loading ? "Loading…" : "Load from drone"}
      </button>
      {error && <span className="text-status-error">{error}</span>}
    </div>
  );
}
