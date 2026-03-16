"use client";

/**
 * @module CloudCommandResultBridge
 * @description Subscribes to completed cloud commands and routes results back into
 * the agent store. Enables cloud mode tabs (Scripts, Peripherals, Fleet, Modules)
 * to receive data from command responses.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { useAgentStore } from "@/stores/agent-store";
import { cmdDroneCommandsApi } from "@/lib/community-api-drones";
import { useConvexAvailable } from "@/app/ConvexClientProvider";

/** Map of command names to the store field they populate */
const COMMAND_RESULT_MAP: Record<string, string> = {
  get_peripherals: "peripherals",
  scan_peripherals: "peripherals",
  get_scripts: "scripts",
  get_suites: "suites",
  get_peers: "peers",
  get_enrollment: "enrollment",
  get_logs: "logs",
  get_services: "services",
};

export function CloudCommandResultBridge() {
  const cloudDeviceId = useAgentStore((s) => s.cloudDeviceId);
  const convexAvailable = useConvexAvailable();
  const processedRef = useRef(new Set<string>());

  const recentCommands = useQuery(
    cmdDroneCommandsApi.listRecentCommands,
    cloudDeviceId && convexAvailable
      ? { deviceId: cloudDeviceId, limit: 10 }
      : "skip"
  );

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
        const storeField = COMMAND_RESULT_MAP[cmd.command];
        if (storeField) {
          useAgentStore.setState({ [storeField]: data });
        }

        // Special handling for run_script results
        if (cmd.command === "run_script") {
          useAgentStore.setState({
            scriptOutput: data,
            runningScript: null,
          });
        }

        // Special handling for save_script — trigger a refresh
        if (cmd.command === "save_script" || cmd.command === "delete_script") {
          useAgentStore.getState().fetchScripts();
        }
      }

      // If command failed and it was a script run, clear the running state
      if (cmd.status === "failed" && cmd.command === "run_script") {
        useAgentStore.setState({
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
