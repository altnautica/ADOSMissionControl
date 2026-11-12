/**
 * @module plugin-contribution-mounts
 * @description Slot matching for plugin contributions, and the demo's
 * in-memory inline mounts. Used by {@link usePluginContributions}.
 * @license GPL-3.0-only
 */

import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import {
  PLUGIN_SLOTS,
  slotOffersOnProfile,
  type GcsContributeRow,
  type PluginSlotName,
  type PairedNodeProfile,
} from "@/lib/plugins/types";
import { getDemoFollowMeContribution } from "@/mock/mock-follow-me";
import { getDemoVisionNavContribution } from "@/mock/mock-vision-nav";
import { DEMO_WORLD_ENGINE_CONTRIBUTIONS } from "@/mock/mock-visor-surfaces";

/** A renderable contribution carrying the slot it mounts into. */
export type SlottedContribution = PluginSlotContribution & { slot: PluginSlotName };

export const EMPTY_CONTRIBUTIONS: ReadonlyArray<SlottedContribution> = Object.freeze([]);

const KNOWN_SLOTS = new Set<string>(PLUGIN_SLOTS);
function isKnownSlot(slot: string): slot is PluginSlotName {
  return KNOWN_SLOTS.has(slot);
}

/** Whether a manifest entry mounts in `slot` (any slot when unset) on a node of
 * `nodeProfile`: a known slot, with a per-node page slot profile-narrowed to
 * the node, matching the header/body filter so an off-profile page never
 * mounts. */
export function entryMounts(
  entry: GcsContributeRow,
  slot: PluginSlotName | undefined,
  nodeProfile: PairedNodeProfile | undefined,
): entry is GcsContributeRow & { slot: PluginSlotName } {
  return (
    (!slot || entry.slot === slot) &&
    isKnownSlot(entry.slot) &&
    slotOffersOnProfile(entry.slot, entry.profile, nodeProfile)
  );
}

/** The demo's inline mounts on a node: the Vision Nav and Follow-Me tab
 * bodies on the demo drones running those extensions, and the world-engine stand-ins for every page
 * its manifest declares on the node's profile (a top-level surface only on a
 * node whose profile is known). In-memory modules handed straight to the host
 * (no trust gate, no agent). */
export function demoInlineContributions(
  deviceId: string | null,
  slot: PluginSlotName | undefined,
  nodeProfile: PairedNodeProfile | undefined,
): ReadonlyArray<SlottedContribution> {
  if (deviceId === null) return EMPTY_CONTRIBUTIONS;
  const out: SlottedContribution[] = [];
  for (const tab of [getDemoVisionNavContribution(deviceId), getDemoFollowMeContribution(deviceId)]) {
    if (tab && entryMounts(tab.entry, slot, nodeProfile)) out.push(tab.contribution);
  }
  for (const page of DEMO_WORLD_ENGINE_CONTRIBUTIONS) {
    if (page.entry.slot === "node.surface" && nodeProfile === undefined) continue;
    if (entryMounts(page.entry, slot, nodeProfile)) out.push(page.contribution);
  }
  return out;
}
