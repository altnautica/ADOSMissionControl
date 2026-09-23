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
 * ArduPilot keeps the home position in mission slot 0 and starts execution at
 * slot 1. With `reserveHomeSlot` the expander writes that home item at seq 0
 * and every mission item (and every DO_JUMP target) starts at seq 1. PX4 and
 * iNav missions start at seq 0.
 *
 * NAV byte-mapping is the one-slot shift (holdTime → param1, param1 → param2,
 * param2 → param3, param3 → param4); the per-command editors write the model
 * slot that lands in the right MAVLink slot (LOITER_TURNS turns and
 * PAYLOAD_PLACE max descent live in `holdTime`, the loiter radius in `param2`).
 *
 * @module mission/mission-expand
 * @license GPL-3.0-only
 */

import type { MissionItem } from "@/lib/protocol/types/mission";
import type {
  ActionCommand,
  AltitudeFrame,
  CommandMissionAction,
  MissionAction,
  RawMissionAction,
  Waypoint,
  WaypointCommand,
} from "@/lib/types/mission";
import { cmdMap, reverseCmd } from "@/lib/mission-io-formats";
import { frameToMav, mavToFrame, MAV_FRAME_GLOBAL } from "@/lib/mission/altitude-frame";
import { isNavCommand, POSITION_BEARING_ACTIONS } from "./command-classes";

// `cmdMap.DO_JUMP` (177) is read inside functions rather than captured at module
// load, so this module never touches an imported binding at load time — that
// keeps the mission-expand ⇄ mission-io-formats import cycle safe from TDZ.
// The frame mapping comes from `mission/altitude-frame`, which has no cycle.

/** A home position written into ArduPilot's reserved mission slot 0. */
export interface HomeSlot {
  lat: number;
  lon: number;
  /** Home altitude, metres AMSL (the slot is written in MAV_FRAME_GLOBAL). */
  alt: number;
}

/** Options for {@link expandToItems}. */
export interface ExpandOptions {
  /** Mission default altitude frame, applied to any waypoint with no explicit frame. */
  defaultFrame: AltitudeFrame;
  /**
   * Write this home position at seq 0 and start the mission at seq 1 (the
   * ArduPilot mission layout). Every DO_JUMP target shifts with the items.
   */
  reserveHomeSlot?: HomeSlot;
}

/** One planned wire slot before sequence numbers are assigned. */
type Slot =
  | { kind: "nav"; wp: Waypoint }
  | { kind: "action"; act: MissionAction; parentFrame: number };

/**
 * Expand a waypoint list into a flat, contiguously-sequenced `MissionItem[]`.
 *
 * - With `reserveHomeSlot`, seq 0 is the home item and the mission starts at 1.
 * - Each navigation waypoint becomes one item using the one-slot-shift mapping.
 * - Each attached action becomes its own item sequenced right after its parent,
 *   using correct MAVLink parameter slots; a raw passthrough action re-emits
 *   the item it was collapsed from.
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
      if (act.command === "DO_JUMP") {
        const target = act.jumpTargetId;
        if (target === undefined || !navIds.has(target)) continue; // drop + re-tighten
      }
      slots.push({ kind: "action", act, parentFrame });
    }
  }

  // The first mission seq: 1 when slot 0 holds the home position.
  const base = opts.reserveHomeSlot ? 1 : 0;

  // Assign seq = base + index and record NAV id → seq for jump resolution.
  const seqById = new Map<string, number>();
  slots.forEach((slot, i) => {
    if (slot.kind === "nav") seqById.set(slot.wp.id, base + i);
  });

  // Pass 2: emit items.
  const items: MissionItem[] = opts.reserveHomeSlot ? [homeItem(opts.reserveHomeSlot)] : [];
  slots.forEach((slot, i) => {
    const seq = base + i;
    items.push(
      slot.kind === "nav"
        ? navItem(slot.wp, seq, seq === base, opts.defaultFrame)
        : actionItem(slot.act, seq, slot.parentFrame, seqById),
    );
  });

  // FLIGHT-SAFETY invariant: contiguous sequence from 0 (home slot included).
  for (let i = 0; i < items.length; i++) {
    if (items[i].seq !== i) {
      throw new Error(
        `mission expand produced a non-contiguous sequence: item ${i} has seq ${items[i].seq}`,
      );
    }
  }

  return items;
}

/** The ArduPilot home item written into mission slot 0. */
function homeItem(home: HomeSlot): MissionItem {
  return {
    seq: 0,
    frame: MAV_FRAME_GLOBAL,
    command: cmdMap.WAYPOINT,
    current: 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(home.lat * 1e7),
    y: Math.round(home.lon * 1e7),
    z: home.alt,
  };
}

/** Encode one navigation waypoint (one-slot-shift byte mapping). */
function navItem(
  wp: Waypoint,
  seq: number,
  first: boolean,
  defaultFrame: AltitudeFrame,
): MissionItem {
  return {
    seq,
    frame: frameToMav(wp.frame ?? defaultFrame),
    command: cmdMap[wp.command ?? "WAYPOINT"] ?? cmdMap.WAYPOINT,
    current: first ? 1 : 0,
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
  if (act.command === "RAW") {
    return {
      seq,
      frame: act.frame,
      command: act.rawCommand,
      current: 0,
      autocontinue: 1,
      param1: act.param1,
      param2: act.param2,
      param3: act.param3,
      param4: act.param4,
      x: act.x,
      y: act.y,
      z: act.z,
    };
  }

  const positional = POSITION_BEARING_ACTIONS.has(act.command);

  // DO_JUMP overrides param1 with the flattened target seq (guaranteed resolved
  // in pass 1) and carries the repeat count in param2.
  const param1 = act.command === "DO_JUMP"
    ? (seqById.get(act.jumpTargetId as string) as number)
    : act.param1 ?? 0;

  return {
    seq,
    frame: parentFrame,
    command: cmdMap[act.command],
    current: 0,
    autocontinue: 1,
    param1,
    param2: act.param2 ?? 0,
    param3: act.param3 ?? 0,
    param4: act.param4 ?? 0,
    // A positional action carries its location in x/y/z; every other action
    // carries MAVLink param5..7 there unscaled (DO_DIGICAM's shoot command).
    x: positional ? Math.round((act.lat ?? 0) * 1e7) : act.param5 ?? 0,
    y: positional ? Math.round((act.lon ?? 0) * 1e7) : act.param6 ?? 0,
    z: positional ? act.alt ?? 0 : act.param7 ?? 0,
  };
}

/**
 * Collapse a flat `MissionItem[]` back into waypoints with attached actions.
 *
 * Each navigation item starts a fresh `Waypoint`; each action item folds into
 * the current waypoint's `actions[]`. A `DO_JUMP` item's raw `param1` (target
 * seq) resolves to the `id` of the navigation waypoint that owns that seq (the
 * greatest NAV seq ≤ the target), so jump targets resolve by absolute seq and a
 * list that starts at seq 1 (ArduPilot, home slot removed) needs no rebasing.
 *
 * A command this GCS does not model is never turned into a navigation
 * waypoint: it rides the current waypoint as a `RAW` passthrough action and
 * re-expands byte-for-byte. Any item before the first navigation item (a known
 * action or an unmodelled command) has no waypoint to ride; it is dropped and
 * reported through `onDropped` so the caller can warn the operator.
 *
 * Each navigation waypoint's altitude FRAME is restored from the item's
 * `MAV_FRAME`. `0` parameter slots collapse to `undefined` (the model treats
 * absent and zero as the same value, and `expandToItems` re-emits `0` for both).
 */
export function collapseFromItems(
  items: readonly MissionItem[],
  onDropped?: (item: MissionItem) => void,
): Waypoint[] {
  const waypoints: Waypoint[] = [];
  /** NAV items in wire order, for jump-target resolution. */
  const navSeqToId: Array<{ seq: number; id: string }> = [];
  /** DO_JUMP actions awaiting a second-pass target-id resolution. */
  const pendingJumps: Array<{ act: CommandMissionAction; targetSeq: number }> = [];

  let current: Waypoint | undefined;

  for (const item of items) {
    const command: WaypointCommand | undefined = reverseCmd[item.command];

    if (command !== undefined && isNavCommand(command)) {
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

    if (!current) {
      onDropped?.(item); // nothing to attach a leading non-nav item to
      continue;
    }

    current.actions = current.actions ?? [];

    if (command === undefined) {
      const raw: RawMissionAction = {
        id: freshId(),
        command: "RAW",
        rawCommand: item.command,
        param1: item.param1,
        param2: item.param2,
        param3: item.param3,
        param4: item.param4,
        x: item.x,
        y: item.y,
        z: item.z,
        frame: item.frame,
      };
      current.actions.push(raw);
      continue;
    }

    const actionCommand = command as ActionCommand;
    const positional = POSITION_BEARING_ACTIONS.has(actionCommand);
    const isJump = actionCommand === "DO_JUMP";

    const action: CommandMissionAction = {
      id: freshId(),
      command: actionCommand,
      // DO_JUMP's param1 is the target seq (→ jumpTargetId), not a user param.
      param1: isJump ? undefined : item.param1 || undefined,
      param2: item.param2 || undefined,
      param3: item.param3 || undefined,
      param4: item.param4 || undefined,
      param5: positional ? undefined : item.x || undefined,
      param6: positional ? undefined : item.y || undefined,
      param7: positional ? undefined : item.z || undefined,
      lat: positional ? item.x / 1e7 : undefined,
      lon: positional ? item.y / 1e7 : undefined,
      alt: positional ? item.z : undefined,
    };
    current.actions.push(action);
    if (isJump) pendingJumps.push({ act: action, targetSeq: item.param1 });
  }

  // Second pass: resolve DO_JUMP target seq → owning NAV waypoint id.
  for (const { act, targetSeq } of pendingJumps) {
    const owner = ownerNavId(navSeqToId, targetSeq);
    if (owner !== undefined) act.jumpTargetId = owner;
  }

  return waypoints;
}

/** A short operator-facing name for a MAV_CMD id ("DO_JUMP", or "MAV_CMD 181"). */
export function missionCommandName(command: number): string {
  const known: WaypointCommand | undefined = reverseCmd[command];
  return known ?? `MAV_CMD ${command}`;
}

/**
 * True when an item's x/y carry a latitude/longitude (degrees × 1e7 on the
 * wire, plain degrees in a text file). A modelled non-positional action carries
 * MAVLink param5/param6 there instead, unscaled. An unmodelled command keeps
 * the location scaling so a file round trip reproduces it.
 */
export function itemCarriesLocation(command: number): boolean {
  const known: WaypointCommand | undefined = reverseCmd[command];
  if (known === undefined || isNavCommand(known)) return true;
  return POSITION_BEARING_ACTIONS.has(known as ActionCommand);
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

/** Generate a fresh short waypoint / action id (matches existing download ids). */
function freshId(): string {
  return Math.random().toString(36).substring(2, 10);
}
