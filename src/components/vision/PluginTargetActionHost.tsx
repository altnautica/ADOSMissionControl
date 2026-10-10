"use client";

/**
 * @module vision/PluginTargetActionHost
 * @description Registers a drone's plugin-contributed TARGET-ACTIONS into the
 * shared target-action registry while the cockpit is mounted, so the click
 * popup lists them beside the built-in actions. Render-null — it only keeps the
 * registry in sync with the drone's installed plugins (unregistering on drone
 * switch / unmount). The action activate runs the gates of the plugin skill
 * that writes the same config key, designates the target (when declared), then
 * writes the plugin's per-drone config over the LAN or the drone's ground
 * station relay.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { isDemoMode } from "@/lib/utils";
import { useDroneTargetActions } from "@/hooks/use-drone-target-actions";
import { useDroneSkillContributions } from "@/hooks/use-drone-skill-contributions";
import {
  PLUGIN_REACH_REQUIRED_REASON,
  writePluginConfigValue,
} from "@/lib/skills/plugin-config-writer";
import {
  buildPluginTargetAction,
  inheritSkillGates,
  useTargetActionRegistry,
  type PluginConfigWrite,
} from "@/lib/skills/target-actions";

/** Flip a plugin's per-drone config over the LAN or ground-station relay.
 * Demo no-ops. A cloud-only drone has no path, which surfaces as the reason. */
const writeConfig: PluginConfigWrite = async (
  pluginId,
  deviceId,
  configKey,
  value,
) => {
  if (isDemoMode()) return;
  const ok = await writePluginConfigValue({
    droneId: deviceId,
    pluginId,
    key: configKey,
    value,
  });
  if (!ok) throw new Error(PLUGIN_REACH_REQUIRED_REASON);
};

export function PluginTargetActionHost({ droneId }: { droneId: string }) {
  const deviceId = deviceIdFromNodeId(droneId) ?? droneId;
  const rawContributions = useDroneTargetActions(deviceId);
  const skills = useDroneSkillContributions(deviceId);
  // An action that flips the same config key as one of the plugin's skills
  // runs behind that skill's confirm and arm gates.
  const contributions = useMemo(
    () => inheritSkillGates(rawContributions, skills ?? []),
    [rawContributions, skills],
  );
  const register = useTargetActionRegistry((s) => s.register);
  const unregister = useTargetActionRegistry((s) => s.unregister);

  useEffect(() => {
    const actions = contributions.map((c) =>
      buildPluginTargetAction(c, droneId, writeConfig),
    );
    actions.forEach((a) => register(a));
    return () => actions.forEach((a) => unregister(a.id));
  }, [contributions, droneId, register, unregister]);

  return null;
}
