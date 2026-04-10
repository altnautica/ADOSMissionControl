"use client";

/**
 * @module CloudStatusBridge
 * @description Bridges Convex cloud drone status into the agent Zustand stores.
 * Mounted when cloudMode is true. Reactively queries cmd_droneStatus and maps
 * to AgentStatus shape that the rest of the UI consumes.
 * Includes heartbeat staleness detection (marks agent offline after 30s).
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useAgentScriptsStore } from "@/stores/agent-scripts-store";
import { useVideoStore } from "@/stores/video-store";
import { cmdDroneStatusApi, cmdDroneCommandsApi } from "@/lib/community-api-drones";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import type { AgentStatus } from "@/lib/agent/types";
import { STALE_THRESHOLD_MS, OFFLINE_THRESHOLD_MS } from "@/lib/agent/freshness";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { inferCapabilities } from "@/lib/agent/infer-capabilities";

const STALE_CHECK_INTERVAL_MS = 5_000; // Check every 5s so the 1Hz UI label stays close to reality

export function CloudStatusBridge() {
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const setCloudStatus = useAgentConnectionStore((s) => s.setCloudStatus);
  const convexAvailable = useConvexAvailable();
  const initialLoadDone = useRef(false);

  const cloudStatus = useConvexSkipQuery(cmdDroneStatusApi.getCloudStatus, {
    args: { deviceId: cloudDeviceId! },
    enabled: !!cloudDeviceId,
  });

  const enqueueCommand = useMutation(cmdDroneCommandsApi.enqueueCommand);

  // Heartbeat monitoring: initial timeout (15s) + staleness detection (10s interval)
  useEffect(() => {
    if (!cloudDeviceId || !convexAvailable) return;

    // Surface error if no cloud status received within 15s
    const timer = setTimeout(() => {
      const current = useAgentConnectionStore.getState();
      if (current.cloudMode && !useAgentSystemStore.getState().status) {
        useAgentConnectionStore.setState({
          connectionError: "No cloud status received. Is the agent paired and online?",
        });
      }
    }, 15000);

    // Ongoing staleness check: two thresholds.
    //   > STALE_THRESHOLD_MS  (20s) → mark system store stale, dim the UI,
    //                                 keep last-known data visible.
    //   > OFFLINE_THRESHOLD_MS (60s) → mark connection offline, clear MAVLink
    //                                  URL so dependent UIs stop trying.
    const interval = setInterval(() => {
      const state = useAgentConnectionStore.getState();
      if (!state.cloudMode || !state.lastCloudUpdate) return;

      const elapsed = Date.now() - state.lastCloudUpdate;

      if (elapsed > STALE_THRESHOLD_MS) {
        const sys = useAgentSystemStore.getState();
        const patch: Record<string, unknown> = {};
        if (!sys.stale) patch.stale = true;
        // Keep the freshness clock in sync with the watchdog. If the user
        // hit Reconnect (which clears lastUpdatedAt to null) and no heartbeat
        // arrived before the grace period elapsed, seed lastUpdatedAt from
        // lastCloudUpdate so useFreshness() starts reporting the correct
        // stale/offline state instead of staying stuck at "unknown".
        if (sys.lastUpdatedAt == null && state.lastCloudUpdate != null) {
          patch.lastUpdatedAt = state.lastCloudUpdate;
        }
        if (Object.keys(patch).length > 0) {
          useAgentSystemStore.setState(patch);
        }
      }

      if (elapsed > OFFLINE_THRESHOLD_MS) {
        const seconds = Math.round(elapsed / 1000);
        const patch: Record<string, unknown> = {
          connectionError: `Agent offline (last seen ${seconds}s ago)`,
        };
        if (state.connected) patch.connected = false;
        if (state.mavlinkUrl) patch.mavlinkUrl = null;
        useAgentConnectionStore.setState(patch);
      }
    }, STALE_CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
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
        ram_mb: cloudStatus.boardRamMb || cloudStatus.memoryTotalMb || 0,
        cpu_cores: cloudStatus.cpuCores || 0,
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

    // Clear any stale error and mark connected on fresh data
    useAgentConnectionStore.setState({
      connected: true,
      connectionError: null,
    });

    setCloudStatus(mapped);

    // Single atomic update to system store — avoids multiple setState calls
    // that can cause React batching issues with stale intermediate states
    const systemUpdate: Record<string, unknown> = {
      status: mapped,
      lastUpdatedAt: Date.now(),
      stale: false,
      resources: {
        cpu_percent: mapped.health.cpu_percent,
        memory_percent: mapped.health.memory_percent,
        memory_used_mb: cloudStatus.memoryUsedMb ?? 0,
        memory_total_mb: cloudStatus.memoryTotalMb ?? 0,
        disk_percent: mapped.health.disk_percent,
        disk_used_gb: cloudStatus.diskUsedGb ?? 0,
        disk_total_gb: cloudStatus.diskTotalGb ?? 0,
        temperature: mapped.health.temperature,
      },
    };

    if (cloudStatus.cpuHistory && Array.isArray(cloudStatus.cpuHistory) && cloudStatus.cpuHistory.length > 0) {
      systemUpdate.cpuHistory = cloudStatus.cpuHistory;
    }
    if (cloudStatus.memoryHistory && Array.isArray(cloudStatus.memoryHistory) && cloudStatus.memoryHistory.length > 0) {
      systemUpdate.memoryHistory = cloudStatus.memoryHistory;
    }

    if (cloudStatus.services && Array.isArray(cloudStatus.services)) {
      systemUpdate.services = cloudStatus.services.map((s: Record<string, unknown>) => ({
        name: s.name,
        status: (["running", "stopped", "error", "degraded", "starting", "circuit_open"].includes(s.status as string) ? s.status : "stopped") as "running" | "stopped" | "error" | "degraded" | "starting" | "circuit_open",
        pid: s.pid ?? null,
        cpu_percent: (s.cpuPercent as number) || 0,
        memory_mb: (s.memoryMb as number) || 0,
        uptime_seconds: (s.uptimeSeconds as number) ?? 0,
        category: s.category as "core" | "hardware" | "suite" | "ondemand" | undefined,
      }));
      systemUpdate.processCpuPercent = cloudStatus.processCpuPercent ?? null;
      systemUpdate.processMemoryMb = cloudStatus.processMemoryMb ?? null;
    }

    if (cloudStatus.logs && Array.isArray(cloudStatus.logs)) {
      systemUpdate.logs = cloudStatus.logs;
    }

    // Single atomic setState for ALL system store fields
    useAgentSystemStore.setState(systemUpdate);

    // Map extended status fields to their respective stores
    if (cloudStatus.peripherals && Array.isArray(cloudStatus.peripherals)) {
      useAgentPeripheralsStore.setState({ peripherals: cloudStatus.peripherals });
    }
    if (cloudStatus.scripts && Array.isArray(cloudStatus.scripts)) {
      useAgentScriptsStore.setState({ scripts: cloudStatus.scripts });
    }
    if (cloudStatus.suites && Array.isArray(cloudStatus.suites)) {
      useAgentScriptsStore.setState({ suites: cloudStatus.suites });
    }
    if (cloudStatus.peers && Array.isArray(cloudStatus.peers)) {
      useAgentScriptsStore.setState({ peers: cloudStatus.peers });
    }
    if (cloudStatus.enrollment && typeof cloudStatus.enrollment === "object") {
      useAgentScriptsStore.setState({ enrollment: cloudStatus.enrollment });
    }

    // Map video status from cloud heartbeat to video store
    const videoState = (cloudStatus as Record<string, unknown>).videoState as string | undefined;
    const videoWhepPort = (cloudStatus as Record<string, unknown>).videoWhepPort as number | undefined;
    const lastIp = (cloudStatus as Record<string, unknown>).lastIp as string | undefined;

    if (videoState) {
      let whepUrl: string | null = null;
      if (videoState === "running" && lastIp && videoWhepPort && videoWhepPort > 0) {
        whepUrl = `http://${lastIp}:${videoWhepPort}/main/whep`;
      }
      useVideoStore.getState().setAgentVideoStatus(videoState, whepUrl);
    }

    // MAVLink WebSocket URL from agent heartbeat
    const mavlinkWsPort = (cloudStatus as Record<string, unknown>).mavlinkWsPort as number | undefined;
    if (lastIp && mavlinkWsPort && mavlinkWsPort > 0) {
      useAgentConnectionStore.getState().setMavlinkUrl(`ws://${lastIp}:${mavlinkWsPort}/`);
    }

    // Infer capabilities from cloud status (board SoC → NPU, peripherals → cameras)
    const capState = useAgentCapabilitiesStore.getState();
    if (!capState.loaded || capState.cameras.length === 0) {
      const peripherals = useAgentPeripheralsStore.getState().peripherals;
      const inferred = inferCapabilities(mapped, peripherals);
      if (inferred) {
        useAgentCapabilitiesStore.getState().setCapabilities(inferred);
      }
    }

    initialLoadDone.current = true;
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
