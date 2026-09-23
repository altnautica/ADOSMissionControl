/**
 * The legacy FLAT waypoint model, where an action rides as its own top-level
 * row after its navigation waypoint instead of nested in `actions[]`. Stored
 * plans written before actions were nested, the CSV interop format and the
 * built-in demo missions use it; {@link foldLegacyWaypoints} nests it and
 * {@link flattenForSerialization} writes it back.
 *
 * @module mission/flat-rows
 * @license GPL-3.0-only
 */

import type {
  ActionCommand,
  CommandMissionAction,
  Waypoint,
} from "@/lib/types/mission";
import { isNavCommand, POSITION_BEARING_ACTIONS } from "./command-classes";

/**
 * One row of the legacy FLAT waypoint model, where an action rides as its own
 * top-level row rather than nested under a navigation waypoint. Identical to a
 * `Waypoint` plus the action-only parameters: the fourth (a nav waypoint's
 * fourth wire slot is `param3`) and, for a non-positional action, the fifth to
 * seventh (its x/y/z wire slots).
 */
export interface FlatWaypointRow extends Waypoint {
  /** Only meaningful on a flattened ACTION row: the action's `param4`. */
  param4?: number;
  /** Only meaningful on a non-positional ACTION row: MAVLink param5..7. */
  param5?: number;
  param6?: number;
  param7?: number;
}

/**
 * Fold a legacy flat waypoint list (where action commands were their own
 * top-level rows) into the nested per-waypoint action model.
 *
 * A navigation waypoint becomes a nav waypoint with its (preserved) actions; a
 * top-level action-command row is converted to a `MissionAction` and pushed into
 * the current navigation waypoint's `actions[]`. Legacy `DO_JUMP` targets are
 * pre-resolved from their old 1-based flat `param1` index to the target
 * element's `id` (or, if that element is itself an action row, the nearest
 * preceding navigation row's `id`). A leading action row (before any navigation
 * waypoint) is dropped with a warning.
 *
 * Idempotent: a list with no top-level action rows (already nested, or pure
 * navigation) passes through with its waypoints and attached actions preserved.
 */
export function foldLegacyWaypoints(flat: readonly FlatWaypointRow[]): Waypoint[] {
  // Pre-resolve each legacy DO_JUMP's 1-based flat target index → an id.
  const jumpTargetIds = new Map<number, string | undefined>();
  flat.forEach((wp, idx) => {
    if ((wp.command ?? "WAYPOINT") !== "DO_JUMP") return;
    const oneBased = wp.param1; // legacy convention: 1-based flat index
    if (oneBased === undefined || !Number.isFinite(oneBased)) {
      jumpTargetIds.set(idx, undefined);
      return;
    }
    const targetIdx = Math.trunc(oneBased) - 1;
    jumpTargetIds.set(idx, resolveLegacyJumpTarget(flat, targetIdx));
  });

  const out: FlatWaypointRow[] = [];
  let current: Waypoint | undefined;

  flat.forEach((wp, idx) => {
    const command = wp.command ?? "WAYPOINT";

    if (isNavCommand(command)) {
      const nav: FlatWaypointRow = { ...wp, actions: wp.actions ? [...wp.actions] : [] };
      // Action-only slots; never meaningful on a nav row.
      delete nav.param4;
      delete nav.param5;
      delete nav.param6;
      delete nav.param7;
      out.push(nav);
      current = nav;
      return;
    }

    // Action-command top-level row.
    if (!current) {
      console.warn(
        `foldLegacyWaypoints: dropping leading action "${command}" that precedes any navigation waypoint`,
      );
      return;
    }

    const actionCommand = command as ActionCommand;
    const positional = POSITION_BEARING_ACTIONS.has(actionCommand);
    const isJump = command === "DO_JUMP";

    const action: CommandMissionAction = {
      id: wp.id,
      command: actionCommand,
      // DO_JUMP: target-param role cleared; repeat kept in param2.
      param1: isJump ? undefined : wp.param1,
      param2: wp.param2,
      param3: wp.param3,
      param4: wp.param4,
      param5: positional ? undefined : wp.param5,
      param6: positional ? undefined : wp.param6,
      param7: positional ? undefined : wp.param7,
      lat: positional ? wp.lat : undefined,
      lon: positional ? wp.lon : undefined,
      alt: positional ? wp.alt : undefined,
    };
    if (isJump) {
      const target = jumpTargetIds.get(idx);
      if (target !== undefined) action.jumpTargetId = target;
    }
    current.actions = current.actions ?? [];
    current.actions.push(action);
  });

  return out;
}

/**
 * Flatten the nested per-waypoint action model into a flat waypoint list where
 * each attached action becomes its own top-level action-command row right after
 * its navigation waypoint. This is the exact inverse of {@link foldLegacyWaypoints}
 * and the shape the human-readable CSV interop format serializes. (The MAVLink
 * flat formats — `.waypoints`, `.plan` — go through `expandToItems` instead, so
 * they carry raw wire parameter slots.)
 *
 * A `DO_JUMP` action's target is written back as a legacy 1-based flat index in
 * `param1` (the convention every flat format + {@link foldLegacyWaypoints} read),
 * so exporting a nested mission then re-importing it preserves the jump. A
 * position-bearing action (`ROI` / `DO_SET_HOME`) keeps its own coordinates; any
 * other action inherits its parent waypoint's position + frame so the flat row
 * is well-formed. An action's `param4`..`param7` ride in the row's own
 * action-only fields. A `RAW` passthrough action has no command name the flat
 * row can carry, so it is not written.
 */
export function flattenForSerialization(waypoints: readonly Waypoint[]): FlatWaypointRow[] {
  const flat: FlatWaypointRow[] = [];
  /** Navigation-waypoint id → its 1-based row index in the flat list. */
  const navFlatIndex = new Map<string, number>();
  /** DO_JUMP rows awaiting their target's 1-based index in `param1`. */
  const jumpRows: Array<{ row: FlatWaypointRow; targetId: string | undefined }> = [];

  for (const wp of waypoints) {
    const navRow: FlatWaypointRow = { ...wp };
    delete navRow.actions; // the NAV row carries no nested actions in flat form
    flat.push(navRow);
    navFlatIndex.set(wp.id, flat.length); // 1-based position of the row just pushed

    for (const act of wp.actions ?? []) {
      if (act.command === "RAW") continue;
      const positional = POSITION_BEARING_ACTIONS.has(act.command);
      const isJump = act.command === "DO_JUMP";
      const row: FlatWaypointRow = {
        id: act.id,
        lat: positional ? act.lat ?? wp.lat : wp.lat,
        lon: positional ? act.lon ?? wp.lon : wp.lon,
        alt: positional ? act.alt ?? wp.alt : wp.alt,
        command: act.command,
        frame: wp.frame,
        // DO_JUMP's param1 is filled with the target's flat index in a second
        // pass; every other action keeps its own parameter values.
        param1: isJump ? undefined : act.param1,
        param2: act.param2,
        param3: act.param3,
        param4: act.param4,
        param5: act.param5,
        param6: act.param6,
        param7: act.param7,
      };
      flat.push(row);
      if (isJump) jumpRows.push({ row, targetId: act.jumpTargetId });
    }
  }

  for (const { row, targetId } of jumpRows) {
    row.param1 = targetId !== undefined ? navFlatIndex.get(targetId) : undefined;
  }

  return flat;
}

/**
 * Resolve a legacy DO_JUMP target: the element at `targetIdx` if it is a
 * navigation waypoint, otherwise the nearest preceding navigation waypoint's id.
 */
function resolveLegacyJumpTarget(
  flat: readonly FlatWaypointRow[],
  targetIdx: number,
): string | undefined {
  if (targetIdx < 0 || targetIdx >= flat.length) return undefined;
  for (let i = targetIdx; i >= 0; i--) {
    if (isNavCommand(flat[i].command ?? "WAYPOINT")) return flat[i].id;
  }
  return undefined;
}
