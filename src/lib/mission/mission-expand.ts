/**
 * Pure mission ⇄ wire mapping: expand a waypoint list (with per-waypoint
 * attached actions) into a flat, contiguously-sequenced `MissionItem[]` and
 * collapse it back. This is the single source of truth for how the GCS's
 * waypoint model maps onto the MAVLink mission wire format.
 *
 * FLIGHT-SAFETY-CRITICAL: a wrong `seq` uploaded to real hardware is a crash.
 * Every expanded item satisfies `items[i].seq === i` (asserted at runtime).
 *
 * Sequence math: a navigation command owns one item at `seq = k`; its attached
 * actions follow at `seq = k+1 … k+m`; the next navigation command starts at
 * `seq = k+m+1`. `DO_JUMP` targets are carried in the model as a waypoint `id`
 * and resolved to the flattened target `seq` here (a two-pass process), so the
 * jump survives editing that shifts sequence numbers.
 *
 * NAV byte-mapping is deliberately identical to the legacy one-slot-shift upload
 * (holdTime → param1, param1 → param2, param2 → param3, param3 → param4) so this
 * change does not alter a single byte of an existing action-free mission.
 *
 * @module mission/mission-expand
 * @license GPL-3.0-only
 */

import type { MissionItem } from "@/lib/protocol/types/mission";
import type {
  ActionCommand,
  AltitudeFrame,
  MissionAction,
  Waypoint,
} from "@/lib/types/mission";
import { cmdMap, reverseCmd } from "@/lib/mission-io-formats";
import { frameToMav, mavToFrame } from "@/lib/mission/altitude-frame";
import { isActionCommand, isNavCommand } from "./command-classes";

// `cmdMap.DO_JUMP` (177) is read inside functions rather than captured at module
// load, so this module never touches an imported binding at load time — that
// keeps the mission-expand ⇄ mission-io-formats import cycle safe from TDZ.
// The frame mapping comes from `mission/altitude-frame`, which has no cycle.

/** Commands whose position (lat/lon/alt) is meaningful as an action item. */
const POSITION_BEARING_ACTIONS: ReadonlySet<ActionCommand> = new Set<ActionCommand>([
  "ROI",
  "DO_SET_HOME",
]);

/**
 * One row of the legacy FLAT waypoint model, where an action rides as its own
 * top-level row rather than nested under a navigation waypoint. Identical to a
 * `Waypoint` plus the action's fourth parameter, which has no navigation
 * counterpart (a nav waypoint's fourth wire slot is `param3`) and was
 * previously dropped on every flatten.
 */
export interface FlatWaypointRow extends Waypoint {
  /** Only meaningful on a flattened ACTION row: the action's `param4`. */
  param4?: number;
}

/** Options for {@link expandToItems}. */
export interface ExpandOptions {
  /** Mission default altitude frame, applied to any waypoint with no explicit frame. */
  defaultFrame: AltitudeFrame;
}

/** One planned wire slot before sequence numbers are assigned. */
type Slot =
  | { kind: "nav"; wp: Waypoint }
  | { kind: "action"; act: MissionAction; parentFrame: number };

/**
 * Expand a waypoint list into a flat, contiguously-sequenced `MissionItem[]`.
 *
 * - Each navigation waypoint becomes one item using the legacy byte mapping.
 * - Each attached action becomes its own item sequenced right after its parent,
 *   using correct MAVLink parameter slots.
 * - `DO_JUMP` actions resolve their `jumpTargetId` to the target's flattened
 *   `seq`; an unresolved / missing target drops that `DO_JUMP` item and the
 *   remaining items re-tighten so `seq` stays contiguous.
 *
 * @throws never — malformed jumps are dropped, not thrown.
 */
export function expandToItems(
  waypoints: readonly Waypoint[],
  opts: ExpandOptions,
): MissionItem[] {
  // The set of navigation-waypoint ids a DO_JUMP is allowed to target.
  const navIds = new Set<string>(waypoints.map((w) => w.id));

  // Pass 1: build the ordered slot list, dropping unresolvable DO_JUMPs so the
  // slot count/order is final before any sequence number is assigned.
  const slots: Slot[] = [];
  for (const wp of waypoints) {
    const parentFrame = frameToMav(wp.frame ?? opts.defaultFrame);
    slots.push({ kind: "nav", wp });
    for (const act of wp.actions ?? []) {
      if (cmdMap[act.command] === cmdMap.DO_JUMP) {
        const target = act.jumpTargetId;
        if (target === undefined || !navIds.has(target)) continue; // drop + re-tighten
      }
      slots.push({ kind: "action", act, parentFrame });
    }
  }

  // Assign seq = index and record NAV id → seq for jump resolution.
  const seqById = new Map<string, number>();
  slots.forEach((slot, seq) => {
    if (slot.kind === "nav") seqById.set(slot.wp.id, seq);
  });

  // Pass 2: emit items.
  const items: MissionItem[] = slots.map((slot, seq) =>
    slot.kind === "nav"
      ? navItem(slot.wp, seq, opts.defaultFrame)
      : actionItem(slot.act, seq, slot.parentFrame, seqById),
  );

  // FLIGHT-SAFETY invariant: contiguous zero-based sequence.
  for (let i = 0; i < items.length; i++) {
    if (items[i].seq !== i) {
      throw new Error(
        `mission expand produced a non-contiguous sequence: item ${i} has seq ${items[i].seq}`,
      );
    }
  }

  return items;
}

/** Encode one navigation waypoint (legacy one-slot-shift byte mapping). */
function navItem(wp: Waypoint, seq: number, defaultFrame: AltitudeFrame): MissionItem {
  return {
    seq,
    frame: frameToMav(wp.frame ?? defaultFrame),
    command: cmdMap[wp.command ?? "WAYPOINT"] ?? cmdMap.WAYPOINT,
    current: seq === 0 ? 1 : 0,
    autocontinue: 1,
    param1: wp.holdTime ?? 0,
    param2: wp.param1 ?? 0,
    param3: wp.param2 ?? 0,
    param4: wp.param3 ?? 0,
    x: Math.round(wp.lat * 1e7),
    y: Math.round(wp.lon * 1e7),
    z: wp.alt,
  };
}

/** Encode one attached action item (correct MAVLink parameter slots). */
function actionItem(
  act: MissionAction,
  seq: number,
  parentFrame: number,
  seqById: Map<string, number>,
): MissionItem {
  const command = cmdMap[act.command];
  const positional = POSITION_BEARING_ACTIONS.has(act.command);

  // DO_JUMP overrides param1 with the flattened target seq (guaranteed resolved
  // in pass 1) and carries the repeat count in param2.
  const isJump = command === cmdMap.DO_JUMP;
  const param1 = isJump
    ? (seqById.get(act.jumpTargetId as string) as number)
    : act.param1 ?? 0;

  return {
    seq,
    frame: parentFrame,
    command,
    current: 0,
    autocontinue: 1,
    param1,
    param2: act.param2 ?? 0,
    param3: act.param3 ?? 0,
    param4: act.param4 ?? 0,
    x: positional ? Math.round((act.lat ?? 0) * 1e7) : 0,
    y: positional ? Math.round((act.lon ?? 0) * 1e7) : 0,
    z: positional ? act.alt ?? 0 : 0,
  };
}

/**
 * Collapse a flat `MissionItem[]` back into waypoints with attached actions.
 *
 * Each navigation item starts a fresh `Waypoint`; each action item folds into
 * the current waypoint's `actions[]`. A `DO_JUMP` item's raw `param1` (target
 * seq) resolves to the `id` of the navigation waypoint that owns that seq (the
 * greatest NAV seq ≤ the target). A leading action item (before any navigation
 * item) is dropped.
 *
 * Each navigation waypoint's altitude FRAME is restored from the item's
 * `MAV_FRAME`. Dropping it (the previous behaviour) made every download and
 * every file import re-label MSL altitudes as relative-to-home, so a
 * download-then-reupload silently changed the mission's vertical datum.
 * `0` parameter slots collapse to `undefined` (the model treats absent and zero
 * as the same value, and `expandToItems` re-emits `0` for both).
 */
export function collapseFromItems(items: readonly MissionItem[]): Waypoint[] {
  const waypoints: Waypoint[] = [];
  /** NAV items in wire order, for jump-target resolution. */
  const navSeqToId: Array<{ seq: number; id: string }> = [];
  /** DO_JUMP actions awaiting a second-pass target-id resolution. */
  const pendingJumps: Array<{ act: MissionAction; targetSeq: number }> = [];

  let current: Waypoint | undefined;

  for (const item of items) {
    const command = reverseCmd[item.command] ?? "WAYPOINT";

    if (isNavCommand(command)) {
      const wp: Waypoint = {
        id: freshId(),
        lat: item.x / 1e7,
        lon: item.y / 1e7,
        alt: item.z,
        command,
        frame: mavToFrame(item.frame),
        holdTime: item.param1 || undefined,
        param1: item.param2 || undefined,
        param2: item.param3 || undefined,
        param3: item.param4 || undefined,
        actions: [],
      };
      waypoints.push(wp);
      navSeqToId.push({ seq: item.seq, id: wp.id });
      current = wp;
      continue;
    }

    if (isActionCommand(command)) {
      if (!current) continue; // leading orphan action → drop
      const actionCommand = command as ActionCommand;
      const positional = POSITION_BEARING_ACTIONS.has(actionCommand);
      const isJump = item.command === cmdMap.DO_JUMP;

      const action: MissionAction = {
        id: freshId(),
        command: actionCommand,
        // DO_JUMP's param1 is the target seq (→ jumpTargetId), not a user param.
        param1: isJump ? undefined : item.param1 || undefined,
        param2: item.param2 || undefined,
        param3: item.param3 || undefined,
        param4: item.param4 || undefined,
        lat: positional ? item.x / 1e7 : undefined,
        lon: positional ? item.y / 1e7 : undefined,
        alt: positional ? item.z : undefined,
      };
      current.actions = current.actions ?? [];
      current.actions.push(action);
      if (isJump) pendingJumps.push({ act: action, targetSeq: item.param1 });
      continue;
    }

    // Unknown / unclassified command: skip.
  }

  // Second pass: resolve DO_JUMP target seq → owning NAV waypoint id.
  for (const { act, targetSeq } of pendingJumps) {
    const owner = ownerNavId(navSeqToId, targetSeq);
    if (owner !== undefined) act.jumpTargetId = owner;
  }

  return waypoints;
}

/** Find the id of the NAV waypoint with the greatest seq ≤ `targetSeq`. */
function ownerNavId(
  navSeqToId: ReadonlyArray<{ seq: number; id: string }>,
  targetSeq: number,
): string | undefined {
  let best: { seq: number; id: string } | undefined;
  for (const nav of navSeqToId) {
    if (nav.seq <= targetSeq && (best === undefined || nav.seq > best.seq)) best = nav;
  }
  return best?.id;
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
      delete nav.param4; // an action-only slot; never meaningful on a nav row
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

    const action: MissionAction = {
      id: wp.id,
      command: actionCommand,
      // DO_JUMP: target-param role cleared; repeat kept in param2.
      param1: isJump ? undefined : wp.param1,
      param2: wp.param2,
      param3: wp.param3,
      param4: wp.param4,
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
 * flat formats — `.waypoints`, `.plan` — go through {@link expandToItems}
 * instead, so they carry raw wire parameter slots.)
 *
 * A `DO_JUMP` action's target is written back as a legacy 1-based flat index in
 * `param1` (the convention every flat format + {@link foldLegacyWaypoints} read),
 * so exporting a nested mission then re-importing it preserves the jump. A
 * position-bearing action (`ROI` / `DO_SET_HOME`) keeps its own coordinates; any
 * other action inherits its parent waypoint's position + frame so the flat row
 * is well-formed. An action's `param4` rides in the row's own `param4`, which
 * has no navigation counterpart — dropping it was a silent data loss on every
 * flatten.
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

/** Generate a fresh short waypoint / action id (matches existing download ids). */
function freshId(): string {
  return Math.random().toString(36).substring(2, 10);
}
