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
 * Speed: a waypoint's `speed` is the ground speed of the leg flown INTO it
 * (absent = the mission default speed). The flight controller only changes
 * speed on a DO_CHANGE_SPEED item, which takes effect when the vehicle leaves
 * the navigation item it follows, so the expander writes one before the first
 * navigation item and one right after navigation item i-1 whenever the leg
 * into waypoint i needs a different speed. `collapseFromItems` folds those
 * items back into `speed`. An operator-attached DO_SET_SPEED action governs
 * the legs after its waypoint until a later waypoint sets its own speed.
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
import { cmdMap, reverseCmd } from "./command-map";
import { frameToMav, mavToFrame, MAV_FRAME_GLOBAL } from "@/lib/mission/altitude-frame";
import { isNavCommand, LOCATION_MAV_CMDS, POSITION_BEARING_ACTIONS } from "./command-classes";


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
  /**
   * Mission default ground speed (m/s) for a waypoint with no `speed`. Absent:
   * only waypoints with an explicit `speed` produce speed items.
   */
  defaultSpeed?: number;
}

/** DO_CHANGE_SPEED speed type written by the expander: ground speed. */
const SPEED_TYPE_GROUND = 1;
/** DO_CHANGE_SPEED throttle value meaning "leave the throttle unchanged". */
const THROTTLE_NO_CHANGE = -1;

/**
 * One planned wire slot before sequence numbers are assigned. `owner` is the
 * index of the planner waypoint the slot belongs to.
 */
type Slot =
  | { kind: "nav"; wp: Waypoint; owner: number }
  | { kind: "action"; act: MissionAction; parentFrame: number; owner: number }
  | { kind: "speed"; speed: number; frame: number; owner: number };

/**
 * Build the ordered slot list: navigation items, their attached actions (an
 * unresolvable DO_JUMP is dropped here so the slot count is final) and the
 * speed items the waypoint speeds require.
 */
function planSlots(
  waypoints: readonly Waypoint[],
  defaultFrame: AltitudeFrame,
  defaultSpeed: number | undefined,
): Slot[] {
  const navIds = new Set<string>(waypoints.map((w) => w.id));
  const slots: Slot[] = [];
  // The speed the vehicle is known to fly at; undefined before the first
  // speed item and after an operator-attached DO_SET_SPEED action.
  let current: number | undefined;
  // True while an attached DO_SET_SPEED action governs the speed: a waypoint
  // with no speed of its own then keeps that speed instead of the default.
  let actionOwnsSpeed = false;

  const pushSpeedFor = (index: number, owner: number, frame: number) => {
    const wp = waypoints[index];
    const want = wp.speed ?? (actionOwnsSpeed ? undefined : defaultSpeed);
    if (want === undefined || !(want > 0) || want === current) return;
    slots.push({ kind: "speed", speed: want, frame, owner });
    current = want;
    actionOwnsSpeed = false;
  };

  waypoints.forEach((wp, i) => {
    const parentFrame = frameToMav(wp.frame ?? defaultFrame);
    if (i === 0) pushSpeedFor(0, 0, parentFrame);
    slots.push({ kind: "nav", wp, owner: i });

    const actions = wp.actions ?? [];
    if (actions.some((a) => a.command === "DO_SET_SPEED")) {
      current = undefined;
      actionOwnsSpeed = true;
    } else if (i + 1 < waypoints.length) {
      // Right after the nav item, ahead of its actions, so a CONDITION_* gate
      // or a DO_JUMP among them cannot delay or skip the leg's speed.
      pushSpeedFor(i + 1, i, parentFrame);
    }

    for (const act of actions) {
      if (act.command === "DO_JUMP") {
        const target = act.jumpTargetId;
        if (target === undefined || !navIds.has(target)) continue; // drop + re-tighten
      }
      slots.push({ kind: "action", act, parentFrame, owner: i });
    }
  });
  return slots;
}

/**
 * The planner waypoint index that owns each item {@link expandToItems}
 * produces, in item order, excluding any home slot.
 */
export function expandedItemOwners(
  waypoints: readonly Waypoint[],
  opts: Pick<ExpandOptions, "defaultSpeed"> = {},
): number[] {
  // Ownership does not depend on the frame; any frame yields the same slots.
  return planSlots(waypoints, "relative", opts.defaultSpeed).map((slot) => slot.owner);
}

/**
 * Expand a waypoint list into a flat, contiguously-sequenced `MissionItem[]`.
 *
 * - With `reserveHomeSlot`, seq 0 is the home item and the mission starts at 1.
 * - Each navigation waypoint becomes one item using the one-slot-shift mapping.
 * - Each attached action becomes its own item sequenced right after its parent,
 *   using correct MAVLink parameter slots; a raw passthrough action re-emits
 *   the item it was collapsed from.
 * - A DO_CHANGE_SPEED item precedes the first leg and follows any navigation
 *   item whose outgoing leg changes speed (see the module note on speed).
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
  const slots = planSlots(waypoints, opts.defaultFrame, opts.defaultSpeed);

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
    switch (slot.kind) {
      case "nav":
        items.push(navItem(slot.wp, seq, slot.owner === 0, opts.defaultFrame));
        break;
      case "action":
        items.push(actionItem(slot.act, seq, slot.parentFrame, seqById));
        break;
      case "speed":
        items.push(speedItem(slot.speed, seq, slot.frame));
        break;
    }
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

/** A DO_CHANGE_SPEED item setting the ground speed, throttle unchanged. */
export function speedItem(speed: number, seq: number, frame: number): MissionItem {
  return {
    seq,
    frame,
    command: cmdMap.DO_SET_SPEED,
    current: 0,
    autocontinue: 1,
    param1: SPEED_TYPE_GROUND,
    param2: speed,
    param3: THROTTLE_NO_CHANGE,
    param4: 0,
    x: 0,
    y: 0,
    z: 0,
  };
}

/** True for exactly the DO_CHANGE_SPEED shape {@link speedItem} writes. */
function isFoldableSpeedItem(item: MissionItem): boolean {
  return item.command === cmdMap.DO_SET_SPEED
    && item.param1 === SPEED_TYPE_GROUND
    && item.param2 > 0
    && item.param3 === THROTTLE_NO_CHANGE
    && item.param4 === 0
    && item.x === 0 && item.y === 0 && item.z === 0;
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
    x: wp.inheritsPosition ? 0 : Math.round(wp.lat * 1e7),
    y: wp.inheritsPosition ? 0 : Math.round(wp.lon * 1e7),
    z: wp.alt,
  };
}

/**
 * Nav commands whose 0,0 location means "the vehicle's position when it gets
 * here" (ArduPilot and PX4 read a zero location that way). RTL ignores its
 * location entirely, and ArduPilot stores and returns it as 0,0; an RTL that
 * does carry coordinates (a file this planner wrote) keeps them so the file
 * round-trips byte for byte.
 */
const ZERO_MEANS_HERE: ReadonlySet<WaypointCommand> = new Set([
  "RTL", "TAKEOFF", "LAND", "LOITER", "LOITER_TIME", "LOITER_TURNS", "VTOL_TAKEOFF", "VTOL_LAND",
]);

function inheritsPosition(command: WaypointCommand, item: MissionItem): boolean {
  return ZERO_MEANS_HERE.has(command) && item.x === 0 && item.y === 0;
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
 *
 * A ground-speed DO_CHANGE_SPEED item of the shape the expander writes, placed
 * before a later navigation item, becomes that waypoint's `speed`, and the
 * speed carries to each following waypoint until the next change, which is
 * how the vehicle flies it. Any other DO_SET_SPEED stays an attached action,
 * and the waypoints after it carry no speed of their own.
 */
export function collapseFromItems(
  items: readonly MissionItem[],
  onDropped?: (item: MissionItem) => void,
  home?: { lat: number; lon: number },
): Waypoint[] {
  const waypoints: Waypoint[] = [];
  /** NAV items in wire order, for jump-target resolution. */
  const navSeqToId: Array<{ seq: number; id: string }> = [];
  /** DO_JUMP actions awaiting a second-pass target-id resolution. */
  const pendingJumps: Array<{ act: CommandMissionAction; targetSeq: number }> = [];

  let current: Waypoint | undefined;
  // Seq-order index of the last navigation item: a speed item after it has no
  // leg to fold into and is kept as an action in place.
  let lastNavIndex = -1;
  items.forEach((item, i) => {
    const cmd = reverseCmd[item.command];
    if (cmd !== undefined && isNavCommand(cmd)) lastNavIndex = i;
  });
  /** Speed set by a folded speed item since the previous navigation item. */
  let pendingSpeed: number | undefined;
  /** Speed the vehicle carries into the next leg, when the model knows it. */
  let carriedSpeed: number | undefined;

  for (const [index, item] of items.entries()) {
    const command: WaypointCommand | undefined = reverseCmd[item.command];

    if (index < lastNavIndex && isFoldableSpeedItem(item)) {
      pendingSpeed = item.param2;
      continue;
    }

    if (command !== undefined && isNavCommand(command)) {
      const speed = pendingSpeed ?? carriedSpeed;
      pendingSpeed = undefined;
      carriedSpeed = speed;
      const inherits = inheritsPosition(command, item);
      // A stand-in position for an item the vehicle flies "from here".
      const standIn = inherits ? (current ?? home) : undefined;
      const wp: Waypoint = {
        id: freshId(),
        lat: standIn ? standIn.lat : item.x / 1e7,
        lon: standIn ? standIn.lon : item.y / 1e7,
        ...(inherits ? { inheritsPosition: true } : {}),
        alt: item.z,
        speed,
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
    if (actionCommand === "DO_SET_SPEED") {
      // This action sets the speed from here on in a way the model does not
      // carry, so the following waypoints keep no speed of their own.
      pendingSpeed = undefined;
      carriedSpeed = undefined;
    }
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

  // A leading position-inheriting item with no previous waypoint and no home
  // takes the next real position (a TAKEOFF climbs where the mission starts).
  const firstPositioned = waypoints.find((w) => !w.inheritsPosition);
  for (const wp of waypoints) {
    if (!wp.inheritsPosition || wp.lat !== 0 || wp.lon !== 0 || !firstPositioned) continue;
    wp.lat = firstPositioned.lat;
    wp.lon = firstPositioned.lon;
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
 * MAVLink param5/param6 there instead, unscaled. An unmodelled command is
 * scaled only when MAVLink defines its param5/param6 as a location.
 */
export function itemCarriesLocation(command: number): boolean {
  const known: WaypointCommand | undefined = reverseCmd[command];
  if (known === undefined) return LOCATION_MAV_CMDS.has(command);
  if (isNavCommand(known)) return true;
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
