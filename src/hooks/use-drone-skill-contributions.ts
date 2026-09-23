"use client";

/**
 * @module use-drone-skill-contributions
 * @description Per-drone `flight.skill` contributions hook. Reads the plugin
 * install rows for one drone from `cmdPlugins.listForDevice`, joins them with
 * each plugin's manifest contributions under the `flight.skill` slot, and
 * returns a stable sorted array the cockpit host registers into the Skill Bar
 * registry.
 *
 * Sort order: by mapped category bucket then by install order, matching the
 * registry's own bar ordering so the bound default slots stay deterministic.
 *
 * Capability gate: a contribution surfaces only when the install granted the
 * `ui.slot.flight-skill` capability — mirroring `PluginSlot`'s
 * `grantedCapabilities.has(requiredCap)` filter so the install record is the
 * source of truth.
 *
 * In demo mode the hook returns a mock contribution set from
 * `src/mock/mock-plugins.ts` so the cockpit Skill Bar shows a plugin slot
 * without a Convex backend or a real agent. In prod, the per-drone denorm of
 * the manifest `gcs.contributes.skills[]` rides the same `listForDevice` row
 * as the drone-detail-tab denorm; before that denorm lands the hook returns
 * `[]`, exactly as the drone-detail-tab hook degrades.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { api } from "../../convex/_generated/api";

import { isDemoMode } from "@/lib/utils";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalAgentPlugins } from "@/hooks/use-local-agent-plugins";
import { getDemoDroneSkillContributions } from "@/mock/mock-plugins";
import {
  mapSkillCategory,
  type DroneSkillContribution,
} from "@/lib/skills/plugin-skills";
import { slotToCapability } from "@/lib/plugins/types";

/** Capability the install must have granted for a flight skill to surface. */
const FLIGHT_SKILL_CAP = slotToCapability("flight.skill");

/** One denormalized `flight.skill` contribution carried on an install row. */
interface SkillContributionRow {
  id?: string;
  label?: string;
  icon?: string;
  category?: "behavior" | "camera" | "navigation" | "utility";
  toggle?: boolean;
  confirm?: boolean;
  armRequirement?: "any" | "armed" | "disarmed" | null;
  configKey?: string;
  stateTopic?: string;
  defaultBinding?: { key?: string | null; gamepadButton?: number | null };
}

/**
 * One install row, the shape both sources (the cloud `cmdPlugins:listForDevice`
 * query and the local agent detail) are projected into. The flight-skill
 * fields are optional: an install that declares none yields no skills.
 */
interface InstallRowForDevice {
  _id: string;
  pluginId: string;
  version: string;
  name: string;
  status:
    | "installed"
    | "enabled"
    | "running"
    | "disabled"
    | "crashed"
    | "removed";
  /** Capability ids the operator granted at install. */
  grantedCapabilities?: string[];
  /** True when the manifest declares any `flight.skill` contribution. */
  contributesFlightSkill?: boolean;
  /** Denormalized `gcs.contributes.skills[]` entries. */
  flightSkills?: SkillContributionRow[];
}

/**
 * Per-drone `flight.skill` contributions for `agentId`. Returns a stable,
 * memoized array once the source has resolved: empty when `agentId` is falsy,
 * in demo mode without matching mock data, or when no install contributes a
 * flight skill. Returns `null` while the active source (the Convex query when
 * signed in, the LAN agent detail when signed out) has not resolved, so the
 * host can tell "not loaded yet" from "nothing installed".
 */
export function useDroneSkillContributions(
  agentId: string | undefined,
): DroneSkillContribution[] | null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const installs = useConvexSkipQuery(api.cmdPlugins.listForDevice, {
    args: agentId ? { deviceId: agentId } : undefined,
    enabled: isAuthenticated && Boolean(agentId),
  });

  // Local-first source: the agent's /plugins detail carries the
  // live granted caps + the denormalized flight skills, so a signed-out
  // operator's cockpit Skill Bar mounts plugin skills with no cloud.
  const localDetail = useLocalAgentPlugins(agentId ?? null);

  return useMemo(() => {
    if (!agentId) return [];

    if (isDemoMode()) {
      return sortSkills(getDemoDroneSkillContributions(agentId));
    }

    if (isAuthenticated ? !installs : !localDetail) return null;

    // Both sources land in the same row shape so the projection is shared.
    const rows: InstallRowForDevice[] = isAuthenticated
      ? (installs ?? [])
      : (localDetail ?? []).map((r) => ({
          _id: r.installId,
          pluginId: r.pluginId,
          version: r.version,
          name: r.name,
          status: r.status as InstallRowForDevice["status"],
          grantedCapabilities: r.grantedCaps,
          flightSkills: r.flightSkills,
        }));

    const out: DroneSkillContribution[] = [];
    for (const row of rows) {
      if (row.status === "removed") continue;
      // Capability gate: the install must have granted ui.slot.flight-skill.
      const granted = new Set(row.grantedCapabilities ?? []);
      if (!granted.has(FLIGHT_SKILL_CAP)) continue;
      const skills = Array.isArray(row.flightSkills) ? row.flightSkills : [];
      for (const s of skills) {
        const localId = typeof s.id === "string" ? s.id : "";
        const configKey = typeof s.configKey === "string" ? s.configKey : "";
        const stateTopic = typeof s.stateTopic === "string" ? s.stateTopic : "";
        // A contribution missing its activation/state wiring can't be driven.
        if (!localId || !configKey || !stateTopic) continue;
        out.push({
          installId: String(row._id),
          pluginId: row.pluginId,
          localId,
          label: typeof s.label === "string" && s.label ? s.label : localId,
          icon: typeof s.icon === "string" && s.icon ? s.icon : "Sparkles",
          category: s.category ?? "behavior",
          toggle: s.toggle === true,
          confirm: s.confirm === true,
          armRequirement:
            s.armRequirement === "armed" ||
            s.armRequirement === "disarmed" ||
            s.armRequirement === "any"
              ? s.armRequirement
              : null,
          configKey,
          stateTopic,
          defaultBinding: s.defaultBinding,
        });
      }
    }

    return sortSkills(out);
  }, [agentId, isAuthenticated, installs, localDetail]);
}

/**
 * Sort by mapped registry category bucket then by stable input (install)
 * order, so the bound default slots and the bar order match the registry.
 */
function sortSkills(
  list: DroneSkillContribution[],
): DroneSkillContribution[] {
  const CATEGORY_RANK: Record<string, number> = {
    behavior: 0,
    camera: 1,
  };
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ra = CATEGORY_RANK[mapSkillCategory(a.c.category)] ?? 0;
      const rb = CATEGORY_RANK[mapSkillCategory(b.c.category)] ?? 0;
      if (ra !== rb) return ra - rb;
      return a.i - b.i;
    })
    .map((x) => x.c);
}
