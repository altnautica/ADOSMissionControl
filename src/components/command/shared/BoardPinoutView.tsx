"use client";

/**
 * @module BoardPinoutView
 * @description Renders a pinout table for the connected flight controller showing
 * output assignments, timer groups, and protocol support.
 * @license GPL-3.0-only
 */

import { useEffect, useState, useMemo } from "react";
import { Cpu, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDroneManager } from "@/stores/drone-manager";
import { detectBoardProfile, type BoardProfile } from "@/lib/board-profiles";

/** 6-color palette for distinguishing timer groups visually. */
const GROUP_COLORS = [
  { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400" },
  { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400" },
  { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400" },
  { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400" },
  { bg: "bg-pink-500/10", border: "border-pink-500/30", text: "text-pink-400" },
  { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400" },
];

interface OutputRow {
  output: number;
  groupIndex: number;
  protocol: string;
  notes?: string;
}

function buildRows(profile: BoardProfile): OutputRow[] {
  const rows: OutputRow[] = [];
  for (let outputNum = 1; outputNum <= profile.outputCount; outputNum++) {
    let groupIndex = -1;
    for (let g = 0; g < profile.timerGroups.length; g++) {
      if (profile.timerGroups[g].includes(outputNum)) {
        groupIndex = g;
        break;
      }
    }
    rows.push({
      output: outputNum,
      groupIndex,
      protocol: groupIndex >= 0 ? profile.protocols[groupIndex] ?? "?" : "?",
      notes: profile.outputNotes[outputNum],
    });
  }
  return rows;
}

export function BoardPinoutView() {
  const drone = useDroneManager((s) => {
    const id = s.selectedDroneId;
    return id ? s.drones.get(id) : null;
  });
  const [boardId, setBoardId] = useState<number | null>(null);

  // Subscribe to AUTOPILOT_VERSION and read initial value if already received
  useEffect(() => {
    if (!drone?.protocol) return;
    // Read current vehicleInfo (may already have boardId if AUTOPILOT_VERSION arrived)
    const currentInfo = drone.protocol.getVehicleInfo();
    if (currentInfo?.boardId !== undefined) {
      setBoardId(currentInfo.boardId);
    }
    // Also subscribe to future updates
    if (drone.protocol.onAutopilotVersion) {
      const unsub = drone.protocol.onAutopilotVersion((info) => {
        setBoardId(info.boardVersion);
      });
      return unsub;
    }
  }, [drone?.protocol]);

  const profile = useMemo(() => {
    if (boardId === null) return null;
    return detectBoardProfile(boardId);
  }, [boardId]);

  const rows = useMemo(() => (profile ? buildRows(profile) : []), [profile]);

  if (!drone) {
    return null;
  }

  if (boardId === null) {
    return (
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center gap-2 mb-2">
          <Cpu size={14} className="text-text-tertiary" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Board Pinout
          </h4>
        </div>
        <p className="text-xs text-text-tertiary">
          Waiting for AUTOPILOT_VERSION message from flight controller...
        </p>
      </div>
    );
  }

  if (!profile || profile.name === "Unknown Board") {
    return (
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center gap-2 mb-2">
          <Cpu size={14} className="text-text-tertiary" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Board Pinout
          </h4>
        </div>
        <p className="text-xs text-text-tertiary">
          Unknown board ID: <span className="font-mono">{boardId}</span>
        </p>
        <p className="text-[10px] text-text-tertiary mt-1">
          This board is not in the pinout database. Add it to <code>src/lib/boards/ardupilot-boards.ts</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-accent-primary" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Board Pinout
            </h4>
          </div>
          <p className="text-sm font-medium text-text-primary mt-1">
            {profile.name}
          </p>
          <p className="text-[10px] text-text-tertiary">
            {profile.vendor} · {profile.outputCount} outputs · {profile.timerGroups.length} timer groups
          </p>
        </div>
        <span className="text-[10px] font-mono text-text-tertiary">
          ID {boardId}
        </span>
      </div>

      {/* Warning if no timer data */}
      {!profile.hasTimerData && (
        <div className="flex items-start gap-2 mb-3 p-2 border border-status-warning/30 bg-status-warning/10 rounded">
          <AlertTriangle size={12} className="text-status-warning shrink-0 mt-0.5" />
          <p className="text-[10px] text-status-warning">
            Timer group data not available for this board. Protocol conflict detection is disabled.
          </p>
        </div>
      )}

      {/* Outputs table */}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-default text-text-tertiary">
                <th className="text-left py-1.5 pr-3 font-medium">Output</th>
                <th className="text-left py-1.5 pr-3 font-medium">Timer Group</th>
                <th className="text-left py-1.5 pr-3 font-medium">Protocol</th>
                <th className="text-left py-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const color = row.groupIndex >= 0
                  ? GROUP_COLORS[row.groupIndex % GROUP_COLORS.length]
                  : null;
                return (
                  <tr key={row.output} className="border-b border-border-default last:border-b-0">
                    <td className="py-1.5 pr-3 font-mono text-text-primary">
                      {row.output}
                    </td>
                    <td className="py-1.5 pr-3">
                      {row.groupIndex >= 0 && color ? (
                        <span
                          className={cn(
                            "inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded border",
                            color.bg,
                            color.border,
                            color.text,
                          )}
                        >
                          Group {row.groupIndex + 1}
                        </span>
                      ) : (
                        <span className="text-text-tertiary text-[10px]">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-text-secondary">
                      {row.protocol}
                    </td>
                    <td className="py-1.5 text-text-tertiary text-[10px]">
                      {row.notes ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">No output data available.</p>
      )}
    </div>
  );
}
