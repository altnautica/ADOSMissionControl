/**
 * @module plugins/transports/build-install-contributions
 * @description Shared install-record projection: turns a parsed manifest's
 * `contributesSlots` / `contributesTabs` / `contributesParameters` into the
 * denormalized `gcsContributes` + `gcsParameters` arrays both finalize paths
 * record (the Convex mirror in `finalize-gcs-install.ts` and the local-first
 * record in `use-install-handler.ts`). Keeping the projection in one place
 * means the `node.detail.tab` profile-narrowing and the parameter pass-through
 * stay identical on both halves.
 *
 * @license GPL-3.0-only
 */

import type { InstallManifestSummary } from "../install-dialog/types";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";
import type {
  GcsContributeRow,
  GcsIsolation,
  PairedNodeProfile,
} from "@/lib/plugins/types";

/** One denormalized slot contribution recorded on the install row. */
export type InstallGcsContribution = GcsContributeRow;

/**
 * How the install row's GCS half mounts: the manifest's declaration, iframe
 * when it declares none, undefined for a plugin with no GCS half.
 */
export function buildGcsIsolation(
  manifest: Pick<InstallManifestSummary, "halves" | "gcsIsolation">,
): GcsIsolation | undefined {
  if (!manifest.halves.includes("gcs")) return undefined;
  return manifest.gcsIsolation ?? "iframe";
}

/** The `node.detail.tab` slot — the only slot a per-tab `profile` narrows. */
const NODE_DETAIL_TAB_SLOT = "node.detail.tab";

/**
 * Project a manifest summary's slot contributions into the install row's
 * `gcsContributes`. For a `node.detail.tab` slot, the matching tab
 * contribution (by `panelId`) supplies the optional `profile` narrowing so
 * the producer can filter the tab to the node's profile. Other slots pass
 * through unchanged.
 */
export function buildGcsContributes(
  manifest: Pick<
    InstallManifestSummary,
    "contributesSlots" | "contributesTabs"
  >,
): InstallGcsContribution[] {
  const tabProfileById = new Map<string, PairedNodeProfile[]>();
  for (const tab of manifest.contributesTabs ?? []) {
    if (tab.profile && tab.profile.length > 0) {
      tabProfileById.set(tab.panelId, [...tab.profile]);
    }
  }
  const rows = (manifest.contributesSlots ?? []).map((c) => {
    const row: InstallGcsContribution = { slot: c.slot, panelId: c.panelId };
    if (c.title !== undefined) row.title = c.title;
    if (c.icon !== undefined) row.icon = c.icon;
    if (c.order !== undefined) row.order = c.order;
    if (c.profile && c.profile.length > 0) row.profile = [...c.profile];
    if (c.section !== undefined) row.section = c.section;
    if (c.after !== undefined) row.after = c.after;
    if (c.group !== undefined) row.group = c.group;
    if (c.setupFor !== undefined) row.setupFor = c.setupFor;
    if (c.slot === NODE_DETAIL_TAB_SLOT) {
      const profile = tabProfileById.get(c.panelId);
      if (profile) row.profile = profile;
    }
    return row;
  });

  // A node-detail tab declared under `contributes.tabs` (rather than as a
  // `panels` entry that names slot node.detail.tab) otherwise only feeds the
  // profile narrowing and never mounts. Emit each such tab as a node.detail.tab
  // slot so the contribution producer mounts it — unless a panels slot already
  // covers the same panelId (in which case the loop above kept it and picked up
  // the tab's profile).
  const mountedTabPanelIds = new Set(
    rows.filter((r) => r.slot === NODE_DETAIL_TAB_SLOT).map((r) => r.panelId),
  );
  for (const tab of manifest.contributesTabs ?? []) {
    if (mountedTabPanelIds.has(tab.panelId)) continue;
    const row: InstallGcsContribution = {
      slot: NODE_DETAIL_TAB_SLOT,
      panelId: tab.panelId,
    };
    if (tab.title !== undefined) row.title = tab.title;
    if (tab.icon !== undefined) row.icon = tab.icon;
    if (tab.order !== undefined) row.order = tab.order;
    if (tab.profile && tab.profile.length > 0) row.profile = [...tab.profile];
    rows.push(row);
    mountedTabPanelIds.add(tab.panelId);
  }
  return rows;
}

/** One denormalized flight-skill contribution recorded on the install row.
 * Matches the shape `use-drone-skill-contributions` reads off the row. */
export interface InstallFlightSkill {
  id: string;
  label?: string;
  icon?: string;
  category?: "behavior" | "camera" | "navigation" | "utility";
  toggle?: boolean;
  confirm?: boolean;
  armRequirement?: "any" | "armed" | "disarmed" | null;
  /** Per-drone config key the skill toggle writes. */
  configKey?: string;
  /** Event topic the skill reads its live state from. */
  stateTopic?: string;
  defaultBinding?: { key?: string | null; gamepadButton?: number | null };
}

/**
 * Project a manifest summary's flight-skill contributions into the install
 * row's persisted `flightSkills` denorm, so a cloud operator's Skill Bar mounts
 * the plugin skill without a manifest re-fetch. Returns undefined when the
 * plugin declares none so the optional record field stays absent.
 */
export function buildGcsFlightSkills(
  manifest: Pick<InstallManifestSummary, "contributesSkills">,
): InstallFlightSkill[] | undefined {
  const skills = manifest.contributesSkills;
  if (!skills || skills.length === 0) return undefined;
  return skills.map((s) => {
    const row: InstallFlightSkill = { id: s.id };
    if (s.label !== undefined) row.label = s.label;
    if (s.icon !== undefined) row.icon = s.icon;
    if (s.category !== undefined) row.category = s.category;
    if (s.toggle !== undefined) row.toggle = s.toggle;
    if (s.confirm !== undefined) row.confirm = s.confirm;
    if (s.armRequirement !== undefined) row.armRequirement = s.armRequirement;
    if (s.configKey !== undefined) row.configKey = s.configKey;
    if (s.stateTopic !== undefined) row.stateTopic = s.stateTopic;
    if (s.defaultBinding) row.defaultBinding = { ...s.defaultBinding };
    return row;
  });
}

/** One denormalized target-action contribution recorded on the install row.
 * Matches the shape `use-drone-target-actions` reads off the row. */
export interface InstallTargetAction {
  id: string;
  label?: string;
  icon?: string;
  order?: number;
  appliesToClass?: string;
  designate?: boolean;
  configKey?: string;
  configValue?: boolean;
  defaultKey?: string;
}

/**
 * Project a manifest summary's target-action contributions into the install
 * row's persisted `targetActions` denorm, so a cloud operator's click-a-target
 * popup lists them beside the built-in actions. Returns undefined when none.
 */
export function buildGcsTargetActions(
  manifest: Pick<InstallManifestSummary, "contributesTargetActions">,
): InstallTargetAction[] | undefined {
  const actions = manifest.contributesTargetActions;
  if (!actions || actions.length === 0) return undefined;
  return actions.map((a) => ({ ...a }));
}

/** Project a manifest summary's parameter contributions for the install row.
 * Returns undefined when the plugin declares none so the optional column /
 * record field stays absent on older-shaped rows. */
export function buildGcsParameters(
  manifest: Pick<InstallManifestSummary, "contributesParameters">,
): PluginParameter[] | undefined {
  const params = manifest.contributesParameters;
  if (!params || params.length === 0) return undefined;
  return params.map((p) => ({ ...p }));
}
