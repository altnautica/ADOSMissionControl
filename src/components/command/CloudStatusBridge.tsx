"use client";

/**
 * @module CloudStatusBridge
 * @description Bridges Convex cloud drone status into the agent Zustand store.
 * Mounted when cloudMode is true. Reactively queries cmd_droneStatus and maps
 * to AgentStatus shape that the rest of the UI consumes.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { useAgentStore } from "@/stores/agent-store";
import { cmdDroneStatusApi, cmdDroneCommandsApi } from "@/lib/community-api-drones";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import type { AgentStatus } from "@/lib/agent/types";

export function CloudStatusBridge() {
  const cloudDeviceId = useAgentStore((s) => s.cloudDeviceId);
  const setCloudStatus = useAgentStore((s) => s.setCloudStatus);
  const convexAvailable = useConvexAvailable();

  const cloudStatus = useQuery(
    cmdDroneStatusApi.getCloudStatus,
    cloudDeviceId && convexAvailable ? { deviceId: cloudDeviceId } : "skip"
  );

  const enqueueCommand = useMutation(cmdDroneCommandsApi.enqueueCommand);

  // Timeout: surface error if no cloud status within 15s
  useEffect(() => {
    if (!cloudDeviceId || !convexAvailable) return;
    const timer = setTimeout(() => {
      const current = useAgentStore.getState();
      if (current.cloudMode && !current.status) {
        useAgentStore.setState({
          connectionError: "No cloud status received. Is the agent paired and online?",
        });
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [cloudDeviceId, convexAvailable]);

  // Map Convex status to AgentStatus
  useEffect(() => {
    if (!cloudStatus) return;

    const mapped: AgentStatus = {
      version: cloudStatus.version || "?.?.?",
      uptime_seconds: cloudStatus.uptimeSeconds || 0,
      board: {
        name: cloudStatus.boardName || "Unknown",
        model: "",
        tier: cloudStatus.boardTier || 0,
        ram_mb: 0,
        cpu_cores: 0,
        vendor: "",
        soc: cloudStatus.boardSoc || "",
        arch: cloudStatus.boardArch || "",
        hw_video_codecs: [],
      },
      health: {
        cpu_percent: cloudStatus.cpuPercent || 0,
        memory_percent: cloudStatus.memoryPercent || 0,
        disk_percent: cloudStatus.diskPercent || 0,
        temperature: cloudStatus.temperature ?? null,
        timestamp: new Date(cloudStatus.updatedAt).toISOString(),
      },
      fc_connected: cloudStatus.fcConnected || false,
      fc_port: cloudStatus.fcPort || "",
      fc_baud: cloudStatus.fcBaud || 0,
    };

    setCloudStatus(mapped);
  }, [cloudStatus, setCloudStatus]);

  // Listen for cloud command events from the store
  useEffect(() => {
    if (!convexAvailable || !cloudDeviceId) return;

    function handleCloudCommand(e: Event) {
      const detail = (e as CustomEvent).detail;
      enqueueCommand({
        deviceId: detail.deviceId,
        command: detail.command,
        args: detail.args,
      }).catch((err) => {
        console.warn("Cloud command enqueue failed:", err);
      });
    }

    window.addEventListener("cloud-command", handleCloudCommand);
    return () => window.removeEventListener("cloud-command", handleCloudCommand);
  }, [enqueueCommand, cloudDeviceId, convexAvailable]);

  return null; // Pure bridge, no UI
}
