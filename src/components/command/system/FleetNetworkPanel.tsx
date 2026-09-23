"use client";

/**
 * @module FleetNetworkPanel
 * @description MQTT gateway status for the broker the fleet bridges actually
 * dial, with an on-demand reachability test, and the ADOS peer roster when
 * the agent reports any peers. Nothing here is a local form: the broker comes
 * from the client config, not from an editable field.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Network, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useFleetNetworkStore } from "@/stores/fleet-network-store";
import { useMqttBrokerTest } from "@/hooks/use-mqtt-broker-test";
import { CollapsibleSection } from "./shared";

export function FleetNetworkPanel() {
  const t = useTranslations("fleetNetwork");
  const connected = useAgentConnectionStore((s) => s.connected);
  const mqttConnected = useAgentConnectionStore((s) => s.mqttConnected);
  const peers = useFleetNetworkStore((s) => s.peers);
  const fetchPeers = useFleetNetworkStore((s) => s.fetchPeers);

  const mqtt = useMqttBrokerTest();

  useEffect(() => {
    if (connected) fetchPeers();
  }, [connected, fetchPeers]);

  return (
    <CollapsibleSection
      title="Fleet Network"
      icon={Network}
      defaultOpen={false}
      badge={peers.length > 0 ? peers.length : undefined}
    >
      <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Wifi size={14} className="text-text-secondary" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              {t("mqttGateway")}
            </h3>
          </div>
          <button
            onClick={() => void mqtt.testConnection()}
            disabled={mqtt.isTesting}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
          >
            {mqtt.isTesting ? <Loader2 size={10} className="animate-spin" /> : <Wifi size={10} />}
            {t("testConnection")}
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
            <p className="text-text-secondary font-mono mt-0.5 text-[11px] break-all">
              {mqtt.brokerUrl}
            </p>
          </div>
        </div>
        {mqtt.lastResult && (
          <p
            className={cn(
              "mt-3 text-[11px]",
              mqtt.lastResult.ok ? "text-status-success" : "text-status-error",
            )}
          >
            {mqtt.lastResult.message}
          </p>
        )}
      </div>

      {/* The peer roster renders only when the agent reports peers; an empty
          roster is not evidence that no peer exists. */}
      {peers.length > 0 && (
        <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t("adosPeers")}
          </h3>
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
        </div>
      )}
    </CollapsibleSection>
  );
}
