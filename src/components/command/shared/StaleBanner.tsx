"use client";

/**
 * @module StaleBanner
 * @description Full-width banner rendered at the top of the Agent Overview tab
 * when the agent heartbeat is stale or offline. Tells the user the data below
 * is last-known, shows how long ago the last update arrived, and offers a
 * Reconnect button for cloud-mode drones.
 * @license GPL-3.0-only
 */

import { AlertTriangle, Plug, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFreshness } from "@/lib/agent/freshness";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

export function StaleBanner() {
  const freshness = useFreshness();
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const connectCloud = useAgentConnectionStore((s) => s.connectCloud);

  if (freshness.state === "live" || freshness.state === "unknown") return null;

  const offline = freshness.state === "offline";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-lg border",
        offline
          ? "bg-status-error/10 border-status-error/30 text-status-error"
          : "bg-status-warning/10 border-status-warning/30 text-status-warning"
      )}
    >
      {offline ? <WifiOff size={16} /> : <AlertTriangle size={16} />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {offline
            ? "Agent offline — no heartbeat received"
            : "Agent feed stale — no fresh heartbeat"}
        </p>
        <p className="text-xs opacity-80">
          Last update {freshness.label}. The values shown below are the last
          readings the agent reported. Flight state may have changed.
        </p>
      </div>
      {cloudMode && cloudDeviceId && (
        <button
          onClick={() => connectCloud(cloudDeviceId)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors shrink-0",
            offline
              ? "bg-status-error/20 hover:bg-status-error/30"
              : "bg-status-warning/20 hover:bg-status-warning/30"
          )}
          title="Re-subscribe to cloud heartbeats"
        >
          <Plug size={12} />
          Reconnect
        </button>
      )}
    </div>
  );
}
