/**
 * @module SimulationPanel
 * @description Unified right-side panel for simulation mode. Contains all simulation
 * controls and data: stats grid, altitude/terrain profiles, active waypoint card,
 * waypoint progress list with ETAs, camera mode buttons, quick actions, history,
 * and keyboard shortcuts reference.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  MapPin,
  ChevronRight,
  ChevronDown,
  Mountain,
  Clock,
  Trash2,
  Keyboard,
  Pencil,
  FileDown,
} from "lucide-react";
import type { Waypoint } from "@/lib/types";
import { formatEta } from "@/lib/simulation-utils";
import { formatAlt } from "@/lib/telemetry-utils";
import { formatDuration } from "@/lib/utils";
import { timeAgo } from "@/lib/plan-library";
import { exportWaypointsFormat } from "@/lib/mission-io";
import { useSimulationStore, type CameraMode } from "@/stores/simulation-store";
import { useInterpolatedPosition } from "@/hooks/use-interpolated-position";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useMissionStore } from "@/stores/mission-store";
import { useSimHistoryStore } from "@/stores/simulation-history-store";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { AltitudeProfile } from "./AltitudeProfile";
import { TerrainProfileChart } from "@/components/planner/TerrainProfileChart";

// ── Camera modes ──────────────────────────────────────────────
const CAMERA_MODES: { id: CameraMode; label: string; key: string; title: string }[] = [
  { id: "topdown", label: "Top-down", key: "T", title: "Bird's eye view" },
  { id: "follow", label: "Follow", key: "F", title: "Chase cam following drone" },
  { id: "orbit", label: "Orbit", key: "O", title: "Orbit around mission" },
  { id: "free", label: "Free", key: "X", title: "Free camera control" },
];

// ── Keyboard shortcuts reference ──────────────────────────────
const SHORTCUTS = [
  { key: "Space", action: "Play / Pause" },
  { key: "Esc", action: "Stop" },
  { key: "R", action: "Reset all" },
  { key: "\u2192", action: "Step forward 1s" },
  { key: "\u2190", action: "Step back 1s" },
  { key: "T", action: "Top-down camera" },
  { key: "F", action: "Follow camera" },
  { key: "O", action: "Orbit camera" },
  { key: "X", action: "Free camera" },
  { key: "1-9", action: "Seek to 10-90%" },
  { key: "]", action: "Increase speed" },
  { key: "[", action: "Decrease speed" },
  { key: "Home", action: "Reset to start" },
  { key: "End", action: "Skip to end" },
  { key: "L", action: "Toggle library" },
];

interface SimulationPanelProps {
  waypoints: Waypoint[];
  onClose: () => void;
}

export function SimulationPanel({
  waypoints,
  onClose,
}: SimulationPanelProps) {
  const router = useRouter();
  const t = useTranslations("simulate");
  const { toast } = useToast();

  // Simulation store
  const totalDuration = useSimulationStore((s) => s.totalDuration);
  const playbackState = useSimulationStore((s) => s.playbackState);
  const cameraMode = useSimulationStore((s) => s.cameraMode);
  const setCameraMode = useSimulationStore((s) => s.setCameraMode);
  const seek = useSimulationStore((s) => s.seek);

  // Other stores
  const activePlanId = usePlanLibraryStore((s) => s.activePlanId);
  const plans = usePlanLibraryStore((s) => s.plans);
  const missionWaypoints = useMissionStore((s) => s.waypoints);
  const historyEntries = useSimHistoryStore((s) => s.entries);
  const clearHistory = useSimHistoryStore((s) => s.clearHistory);

  // Interpolated position
  const { pos, flightPlan, elapsed } = useInterpolatedPosition();

  // Local UI state
  const [terrainExpanded, setTerrainExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false);

  // Derived data
  const activePlan = plans.find((p) => p.id === activePlanId);
  const progressPct = totalDuration > 0 ? Math.min(100, (elapsed / totalDuration) * 100) : 0;

  // Cumulative segment times for ETA calculation
  const cumulativeTimes = useMemo(() => {
    const times: number[] = [];
    for (const seg of flightPlan.segments) {
      times.push(seg.cumulativeDuration);
    }
    return times;
  }, [flightPlan.segments]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleExport = () => {
    if (missionWaypoints.length === 0) return;
    const name = activePlan?.name || "simulation";
    exportWaypointsFormat(missionWaypoints, name);
    toast("Exported .waypoints", "success");
  };

  const handleSeekToWaypoint = (wpIndex: number) => {
    if (wpIndex === 0) {
      seek(0);
    } else {
      const segIdx = Math.min(wpIndex - 1, cumulativeTimes.length - 1);
      if (segIdx >= 0 && cumulativeTimes[segIdx] !== undefined) {
        seek(cumulativeTimes[segIdx]);
      }
    }
  };

  // ── Render ────────────────────────────────────────────────────

  const currentWp = waypoints.length >= 2 ? waypoints[pos.currentWaypointIndex] : null;

  return (
    <div className="w-[320px] shrink-0 flex flex-col border-l border-border-default bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-display font-semibold text-text-primary">{t("title")}</h2>
          {activePlan && (
            <span className="text-[10px] font-mono text-text-tertiary truncate">
              {activePlan.name}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary cursor-pointer shrink-0"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Mission overview stats grid (2x3) */}
        <div className="px-3 py-2 border-b border-border-default grid grid-cols-3 gap-2">
          <div>
            <span className="text-[10px] font-mono text-text-tertiary">{t("duration")}</span>
            <p className="text-xs font-mono text-text-primary">{formatEta(totalDuration)}</p>
          </div>
          <div>
            <span className="text-[10px] font-mono text-text-tertiary">{t("distance")}</span>
            <p className="text-xs font-mono text-text-primary">
              {flightPlan.totalDistance >= 1000
                ? `${(flightPlan.totalDistance / 1000).toFixed(2)} km`
                : `${Math.round(flightPlan.totalDistance)} m`}
            </p>
          </div>
          <div>
            <span className="text-[10px] font-mono text-text-tertiary">{t("speed")}</span>
            <p className="text-xs font-mono text-text-primary">{pos.speed.toFixed(1)} m/s</p>
          </div>
          <div>
            <span className="text-[10px] font-mono text-text-tertiary">{t("heading")}</span>
            <p className="text-xs font-mono text-text-primary">{Math.round(pos.heading)}&deg;</p>
          </div>
          <div>
            <span className="text-[10px] font-mono text-text-tertiary">{t("waypoints")}</span>
            <p className="text-xs font-mono text-text-primary">{waypoints.length}</p>
          </div>
          <div>
            <span className="text-[10px] font-mono text-text-tertiary">{t("progress")}</span>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-primary rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-text-primary">{Math.round(progressPct)}%</span>
            </div>
          </div>
        </div>

        {/* Altitude profile */}
        <div className="px-3 py-2 border-b border-border-default">
          <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-1">
            {t("altitudeProfile")}
          </h3>
          <AltitudeProfile waypoints={waypoints} flightPlan={flightPlan} />
        </div>

        {/* Terrain profile (collapsible) */}
        {waypoints.length >= 2 && (
          <div className="border-b border-border-default">
            <button
              onClick={() => setTerrainExpanded(!terrainExpanded)}
              className="w-full flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-bg-tertiary transition-colors"
            >
              <Mountain size={12} className="text-text-tertiary" />
              <span className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider flex-1 text-left">
                {t("terrainProfile")}
              </span>
              <ChevronDown
                size={12}
                className={cn(
                  "text-text-tertiary transition-transform",
                  terrainExpanded && "rotate-180"
                )}
              />
            </button>
            {terrainExpanded && (
              <TerrainProfileChart waypoints={waypoints} />
            )}
          </div>
        )}

        {/* Active waypoint card */}
        {currentWp && (
          <div className="px-3 py-2 border-b border-border-default">
            <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5">
              {t("activeWaypoint")}
            </h3>
            <div className="bg-accent-primary/10 border border-accent-primary/30 rounded p-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                <MapPin size={10} className="text-accent-primary" />
                <span className="text-xs font-mono font-semibold text-text-primary">
                  WP {pos.currentWaypointIndex + 1} / {waypoints.length}
                </span>
                <span className="text-[9px] font-mono text-accent-primary ml-auto uppercase">
                  {playbackState === "playing" ? "Active" : playbackState}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <span className="text-[9px] text-text-tertiary">Alt</span>
                  <p className="text-[10px] font-mono text-text-primary">{formatAlt(currentWp.alt)}</p>
                </div>
                <div>
                  <span className="text-[9px] text-text-tertiary">Elapsed</span>
                  <p className="text-[10px] font-mono text-text-primary">{formatEta(elapsed)}</p>
                </div>
                <div>
                  <span className="text-[9px] text-text-tertiary">Speed</span>
                  <p className="text-[10px] font-mono text-text-primary">{pos.speed.toFixed(1)} m/s</p>
                </div>
                <div>
                  <span className="text-[9px] text-text-tertiary">Heading</span>
                  <p className="text-[10px] font-mono text-text-primary">{Math.round(pos.heading)}&deg;</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Waypoint progress list with ETAs */}
        <div className="px-3 py-2 border-b border-border-default">
          <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-2">
            {t("waypointProgress")}
          </h3>
          <div className="space-y-1">
            {waypoints.map((wp, i) => {
              const isCurrent = i === pos.currentWaypointIndex;
              const isCompleted = i < pos.currentWaypointIndex;
              const isUpcoming = i > pos.currentWaypointIndex;

              // Calculate ETA for upcoming waypoints
              let eta: number | null = null;
              if (isUpcoming && cumulativeTimes.length > 0) {
                const segIdx = Math.min(i - 1, cumulativeTimes.length - 1);
                if (segIdx >= 0) {
                  eta = Math.max(0, cumulativeTimes[segIdx] - elapsed);
                }
              }

              return (
                <button
                  key={wp.id}
                  onClick={() => handleSeekToWaypoint(i)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors cursor-pointer",
                    isCurrent && "bg-accent-primary/10 border border-accent-primary/30",
                    isCompleted && "opacity-50",
                    isUpcoming && "hover:bg-bg-tertiary"
                  )}
                >
                  <MapPin
                    size={12}
                    className={cn(
                      isCurrent
                        ? "text-accent-primary"
                        : isCompleted
                          ? "text-status-success"
                          : "text-text-tertiary"
                    )}
                  />
                  <span className="text-xs font-mono text-text-primary flex-1">
                    WP {i + 1}
                  </span>
                  <span className="text-[10px] font-mono text-text-tertiary">
                    {formatAlt(wp.alt)}
                  </span>
                  {eta !== null && (
                    <span className="text-[10px] font-mono text-text-tertiary">
                      ETA {formatEta(eta)}
                    </span>
                  )}
                  {isCompleted && (
                    <span className="text-[9px] font-mono text-status-success">&check;</span>
                  )}
                  {isCurrent && (
                    <span className="text-[9px] font-mono text-accent-primary">&bull;</span>
                  )}
                  {wp.holdTime && wp.holdTime > 0 && (
                    <span className="text-[9px] font-mono text-status-warning px-1 py-0.5 bg-status-warning/10 rounded">
                      {wp.holdTime}s
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Camera mode buttons */}
        <div className="px-3 py-2 border-b border-border-default">
          <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-2">
            {t("camera")}
          </h3>
          <div className="flex gap-1.5">
            {CAMERA_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setCameraMode(mode.id)}
                title={mode.title}
                className={cn(
                  "flex-1 px-2 py-1.5 text-[10px] font-mono transition-colors cursor-pointer",
                  cameraMode === mode.id
                    ? "bg-accent-primary text-bg-primary font-semibold"
                    : "bg-bg-tertiary/50 text-text-secondary hover:text-text-primary border border-border-default"
                )}
              >
                [{mode.key}] {mode.label}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="px-3 py-2 border-b border-border-default">
          <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-2">
            {t("quickActions")}
          </h3>
          <div className="flex gap-1.5">
            <button
              onClick={() => router.push("/plan")}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono bg-bg-tertiary/50 text-text-secondary hover:text-text-primary border border-border-default transition-colors cursor-pointer"
            >
              <Pencil size={10} />
              {t("editInPlanner")}
            </button>
            <button
              onClick={handleExport}
              disabled={missionWaypoints.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono bg-bg-tertiary/50 text-text-secondary hover:text-text-primary border border-border-default transition-colors cursor-pointer disabled:opacity-50"
            >
              <FileDown size={10} />
              {t("export")}
            </button>
          </div>
        </div>

        {/* History (collapsible) */}
        {historyEntries.length > 0 && (
          <div className="border-b border-border-default">
            <button
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors cursor-pointer"
            >
              {historyExpanded ? (
                <ChevronDown size={10} className="text-text-tertiary" />
              ) : (
                <ChevronRight size={10} className="text-text-tertiary" />
              )}
              <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider">
                History ({historyEntries.length})
              </h3>
            </button>

            {historyExpanded && (
              <div className="px-3 pb-2">
                <div className="space-y-1">
                  {historyEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-2 px-1.5 py-1"
                    >
                      <Clock size={10} className="text-text-tertiary shrink-0" />
                      <span className="text-[10px] font-mono text-text-primary truncate flex-1">
                        {entry.planName}
                      </span>
                      <span className="text-[10px] font-mono text-text-tertiary">
                        {formatDuration(entry.duration)}
                      </span>
                      <span className="text-[10px] font-mono text-text-tertiary">
                        {timeAgo(entry.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-1 mt-2 text-[10px] text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
                >
                  <Trash2 size={10} />
                  Clear History
                </button>
              </div>
            )}
          </div>
        )}

        {/* Keyboard Shortcuts (collapsible) */}
        <div className="px-3 py-2">
          <button
            onClick={() => setShortcutsExpanded(!shortcutsExpanded)}
            className="w-full flex items-center gap-2 text-[10px] font-mono text-text-tertiary uppercase tracking-wider hover:text-text-secondary cursor-pointer"
          >
            <Keyboard size={12} />
            Keyboard Shortcuts
            {shortcutsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {shortcutsExpanded && (
            <div className="mt-2 space-y-1">
              {SHORTCUTS.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <kbd className="inline-block min-w-[28px] text-center px-1.5 py-0.5 bg-bg-tertiary rounded text-[10px] font-mono text-text-secondary">
                    {s.key}
                  </kbd>
                  <span className="text-xs text-text-tertiary">{s.action}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
