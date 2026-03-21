"use client";

/**
 * @module FleetNetworkTab
 * @description Fleet network management with enrollment, MQTT status, mesh radio, and peer list.
 * @license GPL-3.0-only
 */

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Network, Wifi, Radio, ScanLine, Loader2, Battery, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agent-store";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { DroneNetEnrollmentCard } from "./shared/DroneNetEnrollmentCard";

export function FleetNetworkTab() {
  const t = useTranslations("fleetNetwork");
  const connected = useAgentStore((s) => s.connected);
  const mqttConnected = useAgentStore((s) => s.mqttConnected);
  const peers = useAgentStore((s) => s.peers);
  const fetchPeers = useAgentStore((s) => s.fetchPeers);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);

  useEffect(() => {
    if (connected) fetchPeers();
  }, [connected, fetchPeers]);

  async function handleScan() {
    setScanning(true);
    await fetchPeers();
    setLastScan(new Date());
    setScanning(false);
  }

  if (!connected) {
    return <AgentDisconnectedPage />;
  }

  return (
    <div className="p-4 max-w-3xl space-y-4">
      <DroneNetEnrollmentCard />

      {/* MQTT Status */}
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center gap-2 mb-3">
          <Wifi size={14} className="text-text-secondary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t("mqttGateway")}
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-text-tertiary">Status</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                mqttConnected ? "bg-status-success" : "bg-text-tertiary"
              )} />
              <span className="text-text-primary font-medium">
                {mqttConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
          <div>
            <span className="text-text-tertiary">Broker</span>
            <p className="text-text-secondary font-mono mt-0.5 text-[11px]">
              mqtt.altnautica.com
            </p>
          </div>
        </div>
      </div>

      {/* Mesh Radio */}
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center gap-2 mb-3">
          <Radio size={14} className="text-text-secondary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Mesh Radio
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-text-tertiary">LoRa</span>
            <p className="text-text-secondary mt-0.5">Not installed</p>
          </div>
          <div>
            <span className="text-text-tertiary">WiFi Direct</span>
            <p className="text-text-secondary mt-0.5">Disabled</p>
          </div>
        </div>
      </div>

      {/* Peers */}
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            ADOS Peers
          </h3>
          <div className="flex items-center gap-2">
            {lastScan && (
              <span className="text-[10px] text-text-tertiary">
                Last scan: {lastScan.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center gap-1 px-2 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
            >
              {scanning ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <ScanLine size={10} />
              )}
              Scan
            </button>
          </div>
        </div>

        {peers.length === 0 ? (
          <p className="text-xs text-text-tertiary">No peers discovered</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-default text-text-tertiary">
                  <th className="text-left py-1.5 pr-3 font-medium">Name</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Signal</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Distance</th>
                  <th className="text-right py-1.5 pr-3 font-medium">Battery</th>
                  <th className="text-center py-1.5 pr-3 font-medium">Tier</th>
                  <th className="text-right py-1.5 font-medium">Link</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((peer) => (
                  <tr
                    key={peer.id}
                    className="border-b border-border-default last:border-b-0"
                  >
                    <td className="py-1.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-status-success" />
                        <span className="text-text-primary font-medium">
                          {peer.name}
                        </span>
                        <span className="text-[10px] text-text-tertiary font-mono">
                          {peer.id}
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-text-secondary">
                      {peer.signal_dbm} dBm
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-text-secondary">
                      {peer.distance_m} m
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <span
                        className={cn(
                          "font-mono",
                          peer.battery_percent < 30
                            ? "text-status-error"
                            : peer.battery_percent < 50
                              ? "text-status-warning"
                              : "text-text-secondary"
                        )}
                      >
                        {peer.battery_percent}%
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-tertiary">
                        T{peer.tier}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-text-tertiary">
                      {peer.link_type}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
