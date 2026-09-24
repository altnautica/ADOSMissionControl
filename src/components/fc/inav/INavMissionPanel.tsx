/**
 * @module INavMissionPanel
 * @description iNav mission summary panel.
 * Read-only overview of the current mission loaded in the mission store.
 * Counts waypoints, breaks down by action type, and points the operator
 * at the mission planner tab for edits. Full mission editing lives in the
 * planner, not here.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMissionStore } from "@/stores/mission-store";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { PanelHeader } from "../shared/PanelHeader";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Route, ArrowRight } from "lucide-react";

// ── Action label map ──────────────────────────────────────────

/** iNav waypoint action for each mission command that has one. */
const ACTION_LABELS: Record<string, string> = {
  WAYPOINT: "Waypoint",
  TAKEOFF: "Waypoint",
  LOITER: "Position hold (unlimited)",
  LOITER_TIME: "Position hold (timed)",
  RTL: "Return to home",
  LAND: "Land",
  ROI: "Set point of interest",
  DO_JUMP: "Jump",
  CONDITION_YAW: "Set heading",
};

/** Summary label: the iNav action, or a note that the command cannot upload. */
function actionLabel(command: string): string {
  return ACTION_LABELS[command] ?? `No iNav equivalent (${command})`;
}

// ── Component ─────────────────────────────────────────────────

export function INavMissionPanel() {
  const router = useRouter();
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const waypoints = useMissionStore((s) => s.waypoints);
  const downloadMission = useMissionStore((s) => s.downloadMission);
  const connected = !!selectedProtocol;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRead, setHasRead] = useState(false);

  // Every navigation waypoint and every attached action is one iNav waypoint.
  const { counts, itemCount } = useMemo(() => {
    const tally: Record<string, number> = {};
    let total = 0;
    const add = (label: string) => {
      tally[label] = (tally[label] ?? 0) + 1;
      total += 1;
    };
    for (const wp of waypoints) {
      add(actionLabel(wp.command ?? "WAYPOINT"));
      for (const act of wp.actions ?? []) {
        add(actionLabel(act.command === "RAW" ? `MAV_CMD ${act.rawCommand}` : act.command));
      }
    }
    return { counts: tally, itemCount: total };
  }, [waypoints]);

  const [confirmReplace, setConfirmReplace] = useState(false);

  const readFromFc = useCallback(async () => {
    if (!selectedProtocol) {
      setError("No drone connected");
      return;
    }
    setLoading(true);
    setError(null);
    await downloadMission();
    if (useMissionStore.getState().downloadState === "error") {
      // The plan is left as it was; nothing from a failed read replaces it.
      setError("Mission download failed; the current plan is unchanged");
    } else {
      setHasRead(true);
    }
    setLoading(false);
  }, [selectedProtocol, downloadMission]);

  // A read replaces the plan in the Plan tab, so a non-empty plan is confirmed first.
  const handleRead = useCallback(() => {
    if (useMissionStore.getState().waypoints.length > 0) setConfirmReplace(true);
    else void readFromFc();
  }, [readFromFc]);

  const handleOpenPlanner = useCallback(() => {
    router.push("/plan");
  }, [router]);

  // hasLoaded reflects whether we have mission data to summarize, either from a
  // local plan or from a Read-from-FC pull. Avoids the previous always-true stub.
  const hasLoaded = hasRead || waypoints.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="iNav Mission"
          subtitle="Summary of the mission in the Plan tab or read from the FC."
          icon={<Route size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        />

        <div className="border border-border-default rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-secondary">Total waypoints</span>
            <span className="text-[14px] font-mono text-text-primary">{itemCount} / 60</span>
          </div>

          {waypoints.length === 0 ? (
            <p className="text-[11px] text-text-tertiary">
              No mission loaded. Open the Plan tab to build one.
            </p>
          ) : (
            <div className="space-y-1">
              <span className="text-[10px] text-text-tertiary font-mono">Breakdown by action</span>
              {Object.entries(counts).map(([label, count]) => (
                <div key={label} className="flex items-center justify-between text-[11px]">
                  <span className="text-text-secondary">{label}</span>
                  <span className="font-mono text-text-primary">{count}</span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-2 border-t border-border-default">
            <button
              type="button"
              onClick={handleOpenPlanner}
              className="flex items-center gap-2 text-[11px] px-3 py-1 border border-accent-primary text-accent-primary rounded hover:bg-accent-primary/10"
            >
              Open Mission Planner
              <ArrowRight size={12} />
            </button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmReplace}
          title="Replace the current plan?"
          message={`Reading from the flight controller replaces the ${waypoints.length}-waypoint plan in the Plan tab with the mission stored on the FC.`}
          confirmLabel="Replace plan"
          cancelLabel="Cancel"
          variant="primary"
          onConfirm={() => { setConfirmReplace(false); void readFromFc(); }}
          onCancel={() => setConfirmReplace(false)}
        />

        <div className="border border-border-default rounded p-4 space-y-2">
          <span className="text-[10px] text-text-tertiary font-mono">iNav waypoint actions</span>
          <p className="text-[11px] text-text-secondary">
            iNav supports eight waypoint action types. In the Plan tab, pick Waypoint, Poshold
            (unlimited or timed), RTH or Land as the waypoint action, and attach Set POI, Jump or
            Set heading from the waypoint&apos;s action list.
          </p>
        </div>
      </div>
    </div>
  );
}
