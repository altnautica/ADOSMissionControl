"use client";

/**
 * @module CloudCommandResultBridge
 * @description Subscribes to completed cloud commands and routes results back into
 * the agent store. Enables cloud mode tabs (Peripherals, Fleet, Modules)
 * to receive data from command responses.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useFleetNetworkStore } from "@/stores/fleet-network-store";
import { cmdDroneCommandsApi } from "@/lib/community-api-drones";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { normalizeServiceInfo } from "@/lib/agent/service-state";
import { toLogLevel } from "@/lib/agent/agent-client/logging-wire";
import type { LogEntry } from "@/lib/agent/types";

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/**
 * Route one completed command's `data` into its store. The agent completes a
 * relayed read with the body of the route it ran on the loopback: `/api/logs`
 * answers `{ entries: [{ seq, timestamp, level, logger, message }], … }`
 * (newest first, upper-case level) and `/api/services` answers
 * `{ services: [...], systemd_available, process }`.
 */
export function routeCommandResult(command: string, data: unknown): void {
  switch (command) {
    case "get_peripherals":
    case "scan_peripherals":
      if (Array.isArray(data)) useAgentPeripheralsStore.setState({ peripherals: data });
      return;
    case "get_peers":
      if (Array.isArray(data)) useFleetNetworkStore.setState({ peers: data });
      return;
    case "get_logs": {
      const entries = asRecord(data)?.entries;
      if (!Array.isArray(entries)) return;
      // The viewer expects chronological order.
      const logs: LogEntry[] = [...entries].reverse().map((raw) => {
        const e = asRecord(raw) ?? {};
        return {
          timestamp: typeof e.timestamp === "string" ? e.timestamp : "",
          level: toLogLevel(e.level),
          service: typeof e.logger === "string" ? e.logger : "",
          message: typeof e.message === "string" ? e.message : "",
        };
      });
      useAgentSystemStore.setState({ logs, lastUpdatedAt: Date.now(), stale: false });
      return;
    }
    case "get_services": {
      const services = asRecord(data)?.services;
      if (!Array.isArray(services)) return;
      // Services go through the shared normaliser like every other producer,
      // so an unreported metric stays null rather than landing raw.
      useAgentSystemStore.setState({
        services: services.map((s) => normalizeServiceInfo(asRecord(s) ?? {})),
      });
      return;
    }
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
      // Only terminal rows carry a result; a pending or leased ("delivering")
      // row is revisited once it completes.
      if (cmd.status !== "completed" && cmd.status !== "failed") continue;
      const cmdId = cmd._id as string;
      if (processedRef.current.has(cmdId)) continue;
      processedRef.current.add(cmdId);

      // Route data results to the store
      const data: unknown = "data" in cmd ? cmd.data : undefined;
      if (data !== undefined && data !== null) routeCommandResult(cmd.command, data);

      // Keep the processed set bounded
      if (processedRef.current.size > 50) {
        const arr = Array.from(processedRef.current);
        processedRef.current = new Set(arr.slice(-25));
      }
    }
  }, [recentCommands]);

  return null; // Pure bridge, no UI
}
