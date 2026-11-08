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
  slotToCapability,
  type GcsContributeRow,
  type PluginSlotName,
  type PairedNodeProfile,
} from "@/lib/plugins/types";
import {
  DEMO_INLINE_FIXTURE_MODULE,
  DEMO_INLINE_FIXTURE_PANEL_ID,
  DEMO_INLINE_FIXTURE_PLUGIN_ID,
} from "@/mock/inline-fixture-plugin";
import { getDemoVisionNavContribution } from "@/mock/mock-vision-nav";
import { DEMO_CAPTURE_SURFACES } from "@/mock/mock-visor-surfaces";
import { DEMO_LIVE_WORLD_CONTRIBUTION } from "@/mock/mock-live-world";

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

/** The demo's inline mounts on a drone: the fixture's Agent page, the Vision
 * Nav tab body on the demo drone running that extension, and the live 3D
 * viewer stand-in. In-memory modules handed straight to the host (no trust
 * gate, no agent). */
export function demoInlineContributions(
  deviceId: string | null,
  slot: PluginSlotName | undefined,
  nodeProfile: PairedNodeProfile | undefined,
): ReadonlyArray<SlottedContribution> {
  if (deviceId === null) return EMPTY_CONTRIBUTIONS;
  const out: SlottedContribution[] = [];
  const visionNav = getDemoVisionNavContribution(deviceId);
  if (visionNav && entryMounts(visionNav.entry, slot, nodeProfile)) {
    out.push(visionNav.contribution);
  }
  if (nodeProfile === "visor") {
    for (const surface of DEMO_CAPTURE_SURFACES) {
      if (entryMounts(surface.entry, slot, nodeProfile)) out.push(surface.contribution);
    }
  }
  if (entryMounts(DEMO_LIVE_WORLD_CONTRIBUTION.entry, slot, nodeProfile)) {
    out.push(DEMO_LIVE_WORLD_CONTRIBUTION.contribution);
  }
  const entry: GcsContributeRow = {
    slot: "node.agent.page",
    panelId: DEMO_INLINE_FIXTURE_PANEL_ID,
    profile: ["drone"],
  };
  if (!entryMounts(entry, slot, nodeProfile)) return out;
  out.push({
    slot: "node.agent.page",
    pluginId: DEMO_INLINE_FIXTURE_PLUGIN_ID,
    panelId: DEMO_INLINE_FIXTURE_PANEL_ID,
    title: "Inline Fixture",
    bundleUrl: "",
    isolation: "inline",
    inline: {
      status: "ready",
      bundle: {
        kind: "inline",
        module: DEMO_INLINE_FIXTURE_MODULE,
        trust: {
          pluginId: DEMO_INLINE_FIXTURE_PLUGIN_ID,
          version: "0.0.0-demo",
          signerId: "demo",
          entrypoint: "gcs/fixture.mjs",
          paths: [],
        },
        readAsset: () => Promise.reject(new Error("the demo fixture ships no assets")),
      },
    },
    grantedCapabilities: new Set([slotToCapability("node.agent.page")]),
    handlers: {},
    pluginInstallId: DEMO_INLINE_FIXTURE_PLUGIN_ID,
  });
  return out;
}
