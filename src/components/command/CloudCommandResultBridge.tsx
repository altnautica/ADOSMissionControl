"use client";

/**
 * @module CloudCommandResultBridge
 * @description Subscribes to completed cloud commands and routes results back into
 * the agent store. Enables cloud mode tabs (Scripts, Peripherals, Fleet, Modules)
 * to receive data from command responses.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useAgentScriptsStore } from "@/stores/agent-scripts-store";
import { cmdDroneCommandsApi } from "@/lib/community-api-drones";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";

/** Map of command names to [store, field] for routing results */
type StoreTarget = "system" | "peripherals" | "scripts";
const COMMAND_RESULT_MAP: Record<string, { store: StoreTarget; field: string }> = {
  get_peripherals: { store: "peripherals", field: "peripherals" },
  scan_peripherals: { store: "peripherals", field: "peripherals" },
  get_scripts: { store: "scripts", field: "scripts" },
  get_suites: { store: "scripts", field: "suites" },
  get_peers: { store: "scripts", field: "peers" },
  get_enrollment: { store: "scripts", field: "enrollment" },
  get_logs: { store: "system", field: "logs" },
  get_services: { store: "system", field: "services" },
};

function setStoreField(store: StoreTarget, field: string, data: unknown) {
  const arrayFields = ["peripherals", "scripts", "suites", "peers", "logs", "services"];
  if (arrayFields.includes(field) && !Array.isArray(data)) return;

  switch (store) {
    case "system":
      useAgentSystemStore.setState({ [field]: data } as Record<string, unknown>);
      break;
    case "peripherals":
      useAgentPeripheralsStore.setState({ [field]: data } as Record<string, unknown>);
      break;
    case "scripts":
      useAgentScriptsStore.setState({ [field]: data } as Record<string, unknown>);
      break;
  }
}

export function CloudCommandResultBridge() {
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const processedRef = useRef(new Set<string>());

  const recentCommands = useConvexSkipQuery(cmdDroneCommandsApi.listRecentCommands, {
    args: { deviceId: cloudDeviceId!, limit: 10 },
    enabled: !!cloudDeviceId,
  });

  useEffect(() => {
    if (!recentCommands) return;

    for (const cmd of recentCommands) {
      // Skip already processed or still pending commands
      if (cmd.status === "pending") continue;
      const cmdId = cmd._id as string;
      if (processedRef.current.has(cmdId)) continue;
      processedRef.current.add(cmdId);

      // Route data results to the store
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (cmd as any).data;
      if (data !== undefined && data !== null) {
        const target = COMMAND_RESULT_MAP[cmd.command];
        if (target) {
          setStoreField(target.store, target.field, data);
        }

        // Special handling for run_script results
        if (cmd.command === "run_script") {
          useAgentScriptsStore.setState({
            scriptOutput: data,
            runningScript: null,
          });
        }

        // Special handling for save_script — trigger a refresh
        if (cmd.command === "save_script" || cmd.command === "delete_script") {
          useAgentScriptsStore.getState().fetchScripts();
        }
      }

      // If command failed and it was a script run, clear the running state
      if (cmd.status === "failed" && cmd.command === "run_script") {
        useAgentScriptsStore.setState({
          scriptOutput: {
            stdout: "",
            stderr: cmd.result?.message || "Command failed",
            exitCode: 1,
            durationMs: 0,
          },
          runningScript: null,
        });
      }

      // Keep the processed set bounded
      if (processedRef.current.size > 50) {
        const arr = Array.from(processedRef.current);
        processedRef.current = new Set(arr.slice(-25));
      }
    }
  }, [recentCommands]);

  return null; // Pure bridge, no UI
}
