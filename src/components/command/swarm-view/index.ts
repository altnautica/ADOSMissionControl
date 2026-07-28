/**
 * @module command/swarm-view
 * @description The Swarm tab's five bands, in the order they stack: summary,
 * then exceptions, then detail.
 *
 * Each band takes the store's beacon rows plus the slot→node join and derives
 * the rest itself, so the shell composes them without owning any of their
 * logic. Exempt from the 300-line soft rule: re-export aggregator only.
 *
 * @license GPL-3.0-only
 */

export { SwarmSeverityStrip } from "./SwarmSeverityStrip";
export type { SwarmSeverityStripProps } from "./SwarmSeverityStrip";

export { SwarmActionBar, SWARM_BULK_SKILL_IDS } from "./SwarmActionBar";
export type { SwarmActionBarProps } from "./SwarmActionBar";

export { SwarmBoardTable } from "./SwarmBoardTable";
export type { SwarmBoardTableProps } from "./SwarmBoardTable";

export { SwarmFleetMap } from "./SwarmFleetMap";
export type { SwarmFleetMapProps } from "./SwarmFleetMap";

export { SwarmVideoRail } from "./SwarmVideoRail";
export type { SwarmVideoRailProps } from "./SwarmVideoRail";

export { BroadcastGate } from "./BroadcastGate";
export { BROADCAST_ARM_MS, useBroadcastArm } from "./use-broadcast-arm";
export type { BroadcastArm } from "./use-broadcast-arm";

export { useFleetHero } from "./use-fleet-hero";
export type { FleetHero } from "./use-fleet-hero";

export { useSwarmSlotRows } from "./use-swarm-slot-rows";
export { useSwarmBulkTargets } from "./use-swarm-bulk-targets";
export type { SwarmBulkTargets } from "./use-swarm-bulk-targets";
export { ConditionsCell } from "./SwarmConditionsCell";
export {
  SwarmFormationConfirm,
  SwarmSkillConfirm,
} from "./SwarmActionConfirm";

export {
  SWARM_HEADING_MIN_SPEED_MS,
  SWARM_SEVERITY_IDS,
  SWARM_SEVERITY_LEVEL,
  SWARM_SEVERITY_SHAPE,
  SWARM_SEVERITY_ORDER,
  SWARM_WEAK_RSSI_DBM,
  buildSwarmSlotRows,
  matchesSeverityFilter,
  sortSwarmRowsUnhealthyFirst,
  swarmBeaconFreshness,
  swarmConditionCounts,
  swarmHeadingDeg,
  swarmRowDeviceId,
  swarmRowName,
  swarmRowSeverity,
  swarmSeverityCounts,
} from "./swarm-rows";
export type {
  SwarmConditionCounts,
  SwarmSeverity,
  SwarmSeverityCounts,
  SwarmSeverityId,
  SwarmSlotRow,
} from "./swarm-rows";

export {
  MARQUEE_MIN_DRAG_PX,
  isEnclosingDrag,
  isMarqueeDrag,
  marqueeBounds,
  marqueeSelection,
} from "./marquee";
export type { MarqueePoint, MarqueeRect } from "./marquee";
