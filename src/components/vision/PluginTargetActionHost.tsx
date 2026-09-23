"use client";

/**
 * @module vision/PluginTargetActionHost
 * @description Registers a drone's plugin-contributed TARGET-ACTIONS into the
 * shared target-action registry while the cockpit is mounted, so the click
 * popup lists them beside the built-in actions. Render-null — it only keeps the
 * registry in sync with the drone's installed plugins (unregistering on drone
 * switch / unmount). The action activate designates the target (when declared)
 * then writes the plugin's per-drone config over the LAN.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";

import { PluginAgentClient } from "@/lib/agent/plugin-client";
import { resolveLanAgent } from "@/lib/agent/resolve-agent";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { isDemoMode } from "@/lib/utils";
import { useDroneTargetActions } from "@/hooks/use-drone-target-actions";
import {
  buildPluginTargetAction,
  useTargetActionRegistry,
  type PluginConfigWrite,
} from "@/lib/skills/target-actions";

/** Flip a plugin's per-drone config over the LAN agent (local-first). Demo no-ops. */
const writeConfig: PluginConfigWrite = async (
  pluginId,
  deviceId,
  configKey,
  value,
) => {
  if (isDemoMode()) return;
  const agent = resolveLanAgent(deviceId);
  if (!agent) throw new Error(`no local agent seam for ${deviceId}`);
  await new PluginAgentClient(agent.agentUrl, agent.apiKey).setConfig(
    pluginId,
    configKey,
    value,
    "drone",
  );
};

export function PluginTargetActionHost({ droneId }: { droneId: string }) {
  const deviceId = deviceIdFromNodeId(droneId) ?? droneId;
  const contributions = useDroneTargetActions(deviceId);
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
