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
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentScriptsStore } from "@/stores/agent-scripts-store";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { DroneNetEnrollmentCard } from "./shared/DroneNetEnrollmentCard";

export function FleetNetworkTab() {
  const t = useTranslations("fleetNetwork");
  const connected = useAgentConnectionStore((s) => s.connected);
  const mqttConnected = useAgentConnectionStore((s) => s.mqttConnected);
  const peers = useAgentScriptsStore((s) => s.peers);
  const fetchPeers = useAgentScriptsStore((s) => s.fetchPeers);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [showMqttConfig, setShowMqttConfig] = useState(false);
  const [mqttMode, setMqttMode] = useState<"cloud" | "self-hosted">("cloud");
  const [mqttBrokerUrl, setMqttBrokerUrl] = useState("mqtt.altnautica.com");
  const [mqttUsername, setMqttUsername] = useState("");
  const [mqttPassword, setMqttPassword] = useState("");
  const [mqttTls, setMqttTls] = useState(true);
  const [mqttTesting, setMqttTesting] = useState(false);

  async function handleTestMqtt() {
    setMqttTesting(true);
    // Simulate connection test
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setMqttTesting(false);
  }

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

      {/* MQTT Status & Config */}
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wifi size={14} className="text-text-secondary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              {t("mqttGateway")}
            </h3>
          </div>
          <button
            onClick={() => setShowMqttConfig(!showMqttConfig)}
            className="text-[10px] text-text-tertiary hover:text-accent-primary transition-colors"
          >
            {showMqttConfig ? "Hide Config" : "Configure"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-text-tertiary">{t("status")}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full",
                mqttConnected ? "bg-status-success" : "bg-text-tertiary"
              )} />
              <span className="text-text-primary font-medium">
                {mqttConnected ? t("connected") : t("disconnected")}
              </span>
            </div>
          </div>
          <div>
            <span className="text-text-tertiary">{t("broker")}</span>
            <p className="text-text-secondary font-mono mt-0.5 text-[11px]">
              {mqttBrokerUrl}
            </p>
          </div>
        </div>

        {/* MQTT Config Panel */}
        {showMqttConfig && (
          <div className="mt-3 pt-3 border-t border-border-default space-y-3">
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mqtt-mode"
                  checked={mqttMode === "cloud"}
                  onChange={() => setMqttMode("cloud")}
                  className="accent-accent-primary"
                />
                <span className="text-text-secondary">Cloud (Altnautica)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mqtt-mode"
                  checked={mqttMode === "self-hosted"}
                  onChange={() => setMqttMode("self-hosted")}
                  className="accent-accent-primary"
                />
                <span className="text-text-secondary">Self-Hosted</span>
              </label>
            </div>
            {mqttMode === "self-hosted" && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-text-tertiary uppercase tracking-wider">Broker URL</label>
                  <input
                    type="text"
                    value={mqttBrokerUrl}
                    onChange={(e) => setMqttBrokerUrl(e.target.value)}
                    placeholder="mqtt://192.168.1.100:1883"
                    className="w-full mt-1 px-2.5 py-1.5 text-xs font-mono bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-text-tertiary uppercase tracking-wider">Username</label>
                    <input
                      type="text"
                      value={mqttUsername}
                      onChange={(e) => setMqttUsername(e.target.value)}
                      placeholder="ados"
                      className="w-full mt-1 px-2.5 py-1.5 text-xs font-mono bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-tertiary uppercase tracking-wider">Password</label>
                    <input
                      type="password"
                      value={mqttPassword}
                      onChange={(e) => setMqttPassword(e.target.value)}
                      placeholder="********"
                      className="w-full mt-1 px-2.5 py-1.5 text-xs font-mono bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                    <input type="checkbox" checked={mqttTls} onChange={(e) => setMqttTls(e.target.checked)} className="accent-accent-primary" />
                    TLS/SSL
                  </label>
                  <button
                    onClick={handleTestMqtt}
                    disabled={mqttTesting}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
                  >
                    {mqttTesting ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />}
                    Test Connection
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mesh Radio */}
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center gap-2 mb-3">
          <Radio size={14} className="text-text-secondary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t("meshRadio")}
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-text-tertiary">{t("lora")}</span>
            <p className="text-text-secondary mt-0.5">{t("notInstalled")}</p>
          </div>
          <div>
            <span className="text-text-tertiary">{t("wifiDirect")}</span>
            <p className="text-text-secondary mt-0.5">{t("disabled")}</p>
          </div>
        </div>
      </div>

      {/* Peers */}
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t("adosPeers")}
          </h3>
          <div className="flex items-center gap-2">
            {lastScan && (
              <span className="text-[10px] text-text-tertiary">
                {t("lastScan", { time: lastScan.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}
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
              {t("scan")}
            </button>
          </div>
        </div>

        {peers.length === 0 ? (
          <p className="text-xs text-text-tertiary">{t("noPeersDiscovered")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-default text-text-tertiary">
                  <th className="text-left py-1.5 pr-3 font-medium">{t("peerName")}</th>
                  <th className="text-right py-1.5 pr-3 font-medium">{t("signal")}</th>
                  <th className="text-right py-1.5 pr-3 font-medium">{t("distance")}</th>
                  <th className="text-right py-1.5 pr-3 font-medium">{t("battery")}</th>
                  <th className="text-center py-1.5 pr-3 font-medium">{t("tier")}</th>
                  <th className="text-right py-1.5 font-medium">{t("link")}</th>
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
