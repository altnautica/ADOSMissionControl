"use client";

/**
 * @module FleetNetworkPanel
 * @description Mesh enrollment, MQTT broker status and config form, mesh radio
 * stub status, and discovered ADOS peer roster with on-demand scan.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Network, Radio, ScanLine, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useFleetNetworkStore } from "@/stores/fleet-network-store";
import { useMqttConfig } from "@/hooks/use-mqtt-config";
import { MeshNetEnrollmentCard } from "../shared/MeshNetEnrollmentCard";
import { CollapsibleSection } from "./shared";

export function FleetNetworkPanel() {
  const t = useTranslations("fleetNetwork");
  const connected = useAgentConnectionStore((s) => s.connected);
  const mqttConnected = useAgentConnectionStore((s) => s.mqttConnected);
  const peers = useFleetNetworkStore((s) => s.peers);
  const fetchPeers = useFleetNetworkStore((s) => s.fetchPeers);

  const [peerScanning, setPeerScanning] = useState(false);
  const [lastPeerScan, setLastPeerScan] = useState<Date | null>(null);
  const [showMqttConfig, setShowMqttConfig] = useState(false);

  const mqtt = useMqttConfig();

  useEffect(() => {
    if (connected) fetchPeers();
  }, [connected, fetchPeers]);

  async function handlePeerScan() {
    setPeerScanning(true);
    await fetchPeers();
    setLastPeerScan(new Date());
    setPeerScanning(false);
  }

  return (
    <CollapsibleSection
      title="Fleet Network"
      icon={Network}
      defaultOpen={false}
      badge={peers.length > 0 ? peers.length : undefined}
    >
      <MeshNetEnrollmentCard />

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
              {mqtt.config.brokerUrl}
            </p>
          </div>
        </div>

        {showMqttConfig && (
          <div className="mt-3 pt-3 border-t border-border-default space-y-3">
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mqtt-mode"
                  checked={mqtt.config.mode === "cloud"}
                  onChange={() => mqtt.setMode("cloud")}
                  className="accent-accent-primary"
                />
                <span className="text-text-secondary">Cloud (Altnautica)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mqtt-mode"
                  checked={mqtt.config.mode === "self-hosted"}
                  onChange={() => mqtt.setMode("self-hosted")}
                  className="accent-accent-primary"
                />
                <span className="text-text-secondary">Self-Hosted</span>
              </label>
            </div>
            {mqtt.config.mode === "self-hosted" && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-text-tertiary uppercase tracking-wider">Broker URL</label>
                  <input
                    type="text"
                    value={mqtt.config.brokerUrl}
                    onChange={(e) => mqtt.setBrokerUrl(e.target.value)}
                    placeholder="mqtt://192.168.1.100:1883"
                    className="w-full mt-1 px-2.5 py-1.5 text-xs font-mono bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-text-tertiary uppercase tracking-wider">Username</label>
                    <input
                      type="text"
                      value={mqtt.config.username}
                      onChange={(e) => mqtt.setUsername(e.target.value)}
                      placeholder="ados"
                      className="w-full mt-1 px-2.5 py-1.5 text-xs font-mono bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-tertiary uppercase tracking-wider">Password</label>
                    <input
                      type="password"
                      value={mqtt.config.password}
                      onChange={(e) => mqtt.setPassword(e.target.value)}
                      placeholder="********"
                      className="w-full mt-1 px-2.5 py-1.5 text-xs font-mono bg-bg-primary border border-border-default rounded text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mqtt.config.tls}
                      onChange={(e) => mqtt.setTls(e.target.checked)}
                      className="accent-accent-primary"
                    />
                    TLS/SSL
                  </label>
                  <button
                    onClick={mqtt.testConnection}
                    disabled={mqtt.isTesting}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
                  >
                    {mqtt.isTesting ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />}
                    Test Connection
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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

      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t("adosPeers")}
          </h3>
          <div className="flex items-center gap-2">
            {lastPeerScan && (
              <span className="text-[10px] text-text-tertiary">
                {t("lastScan", { time: lastPeerScan.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) })}
              </span>
            )}
            <button
              onClick={handlePeerScan}
              disabled={peerScanning}
              className="flex items-center gap-1 px-2 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
            >
              {peerScanning ? (
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
                      {peer.signal_dbm === undefined ? NO_DATA_GLYPH : `${peer.signal_dbm} dBm`}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-text-secondary">
                      {peer.distance_m === undefined ? NO_DATA_GLYPH : `${peer.distance_m} m`}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {/* An unreported battery is NOT 0%: rendering it as one
                          painted every peer that omits the field red-critical. */}
                      <span
                        className={cn(
                          "font-mono",
                          peer.battery_percent === undefined
                            ? "text-text-tertiary"
                            : peer.battery_percent < 30
                              ? "text-status-error"
                              : peer.battery_percent < 50
                                ? "text-status-warning"
                                : "text-text-secondary"
                        )}
                      >
                        {peer.battery_percent === undefined ? NO_DATA_GLYPH : `${peer.battery_percent}%`}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-bg-tertiary text-text-tertiary">
                        {peer.tier === undefined ? NO_DATA_GLYPH : `T${peer.tier}`}
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
    </CollapsibleSection>
  );
}
