/**
 * @module WaypointActionTimeline
 * @description The "Actions" sub-section shown inside an expanded waypoint row:
 * an indented, drag-reorderable list of the actions attached to that waypoint,
 * plus a grouped "Add action" picker. Every edit flows through the waypoint's
 * onUpdate so it inherits undo/redo and persistence for free.
 * @license GPL-3.0-only
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Select, type SelectOptionGroup } from "@/components/ui/select";
import type { ActionCommand, CommandMissionAction, MissionAction, Waypoint } from "@/lib/types";
import { useMissionStore } from "@/stores/mission-store";
import { randomId } from "@/lib/utils";
import { useDroneManager } from "@/stores/drone-manager";
import { ACTION_COMMAND_GROUPS, defaultActionParams } from "./waypoint-constants";
import { ActionRow, type NavTarget } from "./ActionRow";

interface WaypointActionTimelineProps {
  waypoint: Waypoint;
  onUpdate: (update: Partial<Waypoint>) => void;
  /** Restrict the "Add action" picker to these commands (e.g. what iNav can fly). */
  allowedCommands?: readonly ActionCommand[];
}

export function WaypointActionTimeline({ waypoint, onUpdate, allowedCommands }: WaypointActionTimelineProps) {
  const t = useTranslations("planner");
  const allWaypoints = useMissionStore((s) => s.waypoints);
  const actions = waypoint.actions ?? [];

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Every navigation waypoint is a valid DO_JUMP target, labelled by 1-based seq.
  const targets: NavTarget[] = allWaypoints.map((wp, i) => ({
    id: wp.id,
    label: t("actions.wpLabel", { n: i + 1 }),
  }));

  const addOptions: SelectOptionGroup[] = ACTION_COMMAND_GROUPS.map((g) => ({
    label: t(`actions.group.${g.groupKey}`),
    options: g.commands
      .filter((c) => !allowedCommands || allowedCommands.includes(c))
      .map((c) => ({ value: c, label: t(`actions.cmd.${c}`) })),
  })).filter((g) => g.options.length > 0);

  const addAction = (command: ActionCommand) => {
    const vehicleClass = useDroneManager.getState().getSelectedProtocol()?.getVehicleInfo()?.vehicleClass;
    const action: CommandMissionAction = {
      id: randomId(), command, ...defaultActionParams(command, waypoint, vehicleClass),
    };
    onUpdate({ actions: [...actions, action] });
    setExpandedId(action.id);
  };

  const updateAction = (id: string, partial: Partial<CommandMissionAction>) => {
    onUpdate({
      actions: actions.map((a): MissionAction =>
        a.id === id && a.command !== "RAW" ? { ...a, ...partial } : a,
      ),
    });
  };

  const removeAction = (id: string) => {
    onUpdate({ actions: actions.filter((a) => a.id !== id) });
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...actions];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onUpdate({ actions: next });
  };

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border-default" />
        <span className="text-[9px] font-mono uppercase tracking-wider text-text-tertiary">
          {t("actions.title")}
        </span>
        <div className="h-px flex-1 bg-border-default" />
      </div>

      {actions.length > 0 && (
        <div className="flex flex-col gap-1 pl-1">
          {actions.map((action, i) => (
            <ActionRow
              key={action.id}
              action={action}
              targets={targets}
              expanded={expandedId === action.id}
              onToggleExpand={() => setExpandedId(expandedId === action.id ? null : action.id)}
              onUpdate={(partial) => updateAction(action.id, partial)}
              onRemove={() => removeAction(action.id)}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i); }}
              onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) reorder(dragIndex, i);
                setDragIndex(null);
                setDragOverIndex(null);
              }}
              dragOver={dragOverIndex === i && dragIndex !== null && dragIndex !== i}
            />
          ))}
        </div>
      )}

      <Select
        value=""
        placeholder={t("actions.add")}
        options={addOptions}
        onChange={(v) => addAction(v as ActionCommand)}
      />
    </div>
  );
}
