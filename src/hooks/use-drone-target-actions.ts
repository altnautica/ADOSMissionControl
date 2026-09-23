"use client";

/**
 * @module use-drone-target-actions
 * @description Per-drone plugin TARGET-ACTION contributions. Mirrors
 * `use-drone-skill-contributions`: it reads the drone's plugin install rows and
 * surfaces each plugin's `targetActions[]` (an additive denorm off the same
 * `cmdPlugins:listForDevice` row) so the cockpit registers them into the shared
 * target-action registry — the popup then lists them beside the built-in
 * actions. In demo mode it returns a mock so the popup shows a cross-plugin
 * action with no backend. Before the denorm lands (or with no contributing
 * plugin) it returns `[]`, exactly as the flight-skill hook degrades.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { makeFunctionReference } from "convex/server";

import { isDemoMode } from "@/lib/utils";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalAgentPlugins } from "@/hooks/use-local-agent-plugins";
import { getDemoDroneTargetActions } from "@/mock/mock-plugins";
import type { DroneTargetActionContribution } from "@/lib/skills/target-actions";

/** One denormalized `targetActions[]` entry on an install row (additive). */
interface TargetActionRow {
  id?: string;
  label?: string;
  icon?: string;
  order?: number;
  appliesToClass?: string;
  designate?: boolean;
  configKey?: string;
  configValue?: boolean;
  defaultKey?: string;
}

interface InstallRowWithTargetActions {
  _id: string;
  pluginId: string;
  status: "installed" | "enabled" | "running" | "disabled" | "crashed" | "removed";
  targetActions?: TargetActionRow[];
}

const listForDeviceRef = makeFunctionReference<
  "query",
  { deviceId: string },
  InstallRowWithTargetActions[]
>("cmdPlugins:listForDevice");

export function useDroneTargetActions(
  agentId: string | undefined,
): DroneTargetActionContribution[] {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const installs = useConvexSkipQuery(listForDeviceRef, {
    args: agentId ? { deviceId: agentId } : undefined,
    enabled: isAuthenticated && Boolean(agentId),
  });

  // Local-first source: the agent's /plugins detail carries the
  // denormalized target actions, so a signed-out operator's cockpit still
  // surfaces a plugin's target actions over the LAN with no cloud.
  const localDetail = useLocalAgentPlugins(agentId ?? null);

  return useMemo(() => {
    if (!agentId) return [];
    if (isDemoMode()) return getDemoDroneTargetActions(agentId);

    // Both sources land in the same row shape so the projection is shared.
    const rows: InstallRowWithTargetActions[] = isAuthenticated
      ? (installs ?? [])
      : (localDetail ?? []).map((r) => ({
          _id: r.installId,
          pluginId: r.pluginId,
          status: r.status as InstallRowWithTargetActions["status"],
          targetActions: r.targetActions,
        }));

    if (isAuthenticated ? !installs : !localDetail) return [];

    const out: DroneTargetActionContribution[] = [];
    for (const row of rows) {
      if (row.status === "removed") continue;
      const actions = Array.isArray(row.targetActions) ? row.targetActions : [];
      for (const a of actions) {
        const localId = typeof a.id === "string" ? a.id : "";
        const label = typeof a.label === "string" ? a.label : "";
        if (!localId || !label) continue;
        out.push({
          installId: String(row._id),
          pluginId: row.pluginId,
          localId,
          label,
          icon: typeof a.icon === "string" ? a.icon : undefined,
          order: typeof a.order === "number" ? a.order : undefined,
          appliesToClass:
            typeof a.appliesToClass === "string" ? a.appliesToClass : undefined,
          designate: a.designate === true,
          configKey: typeof a.configKey === "string" ? a.configKey : undefined,
          configValue: a.configValue,
          defaultKey: typeof a.defaultKey === "string" ? a.defaultKey : undefined,
        });
      }
    }
    return out;
  }, [agentId, installs, localDetail, isAuthenticated]);
}
