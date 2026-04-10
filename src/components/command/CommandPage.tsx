"use client";

/**
 * @module CommandPage
 * @description Main layout for the Command tab with fleet sidebar, sub-tab switching, and drone context rail.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Monitor,
  TerminalSquare,
  Wrench,
  Sparkles,
  Zap,
  Plug,
  Unplug,
  ChevronDown,
  ChevronRight,
  Cloud,
} from "lucide-react";
import { cn, isDemoMode } from "@/lib/utils";
import { cmdDronesApi } from "@/lib/community-api-drones";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useFreshness } from "@/lib/agent/freshness";
import { useVisibleTabs, type CommandSubTab } from "@/hooks/use-visible-tabs";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import dynamic from "next/dynamic";
import { FleetSidebar } from "./FleetSidebar";
import { PairingDialog } from "./PairingDialog";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { DroneContextRail } from "./shared/DroneContextRail";

const AgentOverviewTab = dynamic(() => import("./AgentOverviewTab").then(m => ({ default: m.AgentOverviewTab })), { ssr: false });
const ScriptsTab = dynamic(() => import("./ScriptsTab").then(m => ({ default: m.ScriptsTab })), { ssr: false });
const FeaturesTab = dynamic(() => import("./FeaturesTab").then(m => ({ default: m.FeaturesTab })), { ssr: false });
const SystemTab = dynamic(() => import("./SystemTab").then(m => ({ default: m.SystemTab })), { ssr: false });
const CloudStatusBridge = dynamic(() => import("./CloudStatusBridge").then(m => ({ default: m.CloudStatusBridge })), { ssr: false });
const CloudCommandResultBridge = dynamic(() => import("./CloudCommandResultBridge").then(m => ({ default: m.CloudCommandResultBridge })), { ssr: false });
const MqttBridge = dynamic(() => import("./MqttBridge").then(m => ({ default: m.MqttBridge })), { ssr: false });
// AgentMavlinkBridge moved to CommandShell for cross-tab persistence

export function CommandPage() {
  const t = useTranslations("command");

  const visibleTabs = useVisibleTabs();
  const activeFeatureName = useAgentCapabilitiesStore((s) => s.features.active);

  const tabConfig: Record<CommandSubTab, { label: string; icon: typeof Monitor }> = useMemo(() => ({
    overview: { label: t("overview"), icon: Monitor },
    features: { label: "Features", icon: Sparkles },
    "smart-modes": { label: "Smart Modes", icon: Zap },
    system: { label: "System", icon: Wrench },
    scripts: { label: t("scripts"), icon: TerminalSquare },
  }), [t]);

  const [activeTab, setActiveTab] = useState<CommandSubTab>("overview");
  const [urlInput, setUrlInput] = useState("http://localhost:8080");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const connected = useAgentConnectionStore((s) => s.connected);
  const connectionError = useAgentConnectionStore((s) => s.connectionError);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const status = useAgentSystemStore((s) => s.status);
  const connect = useAgentConnectionStore((s) => s.connect);
  const disconnect = useAgentConnectionStore((s) => s.disconnect);
  const connectCloud = useAgentConnectionStore((s) => s.connectCloud);
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const freshness = useFreshness();
  // When we have a status object but the watchdog has flagged the feed as
  // stale/offline, render the dimmed/offline header rather than the live one.
  const headerState: "live" | "stale" | "offline" =
    !connected || freshness.state === "offline"
      ? "offline"
      : freshness.state === "stale"
        ? "stale"
        : "live";

  const demo = isDemoMode();
  const pairedDrones = usePairingStore((s) => s.pairedDrones);

  const clientConfig = useConvexSkipQuery(communityApi.clientConfig.get);
  const myDrones = useConvexSkipQuery(cmdDronesApi.listMyDrones);

  // Sync Convex fleet data into Zustand store (deduplicate by deviceId, keep newest)
  useEffect(() => {
    if (myDrones && Array.isArray(myDrones)) {
      const deduped = new Map<string, typeof myDrones[number]>();
      for (const d of myDrones) {
        const existing = deduped.get(d.deviceId);
        if (!existing || (d.pairedAt || 0) > (existing.pairedAt || 0)) {
          deduped.set(d.deviceId, d);
        }
      }
      usePairingStore.getState().setPairedDrones(
        Array.from(deduped.values()).map((d) => ({
          _id: d._id,
          userId: d.userId,
          deviceId: d.deviceId,
          name: d.name,
          apiKey: d.apiKey,
          agentVersion: d.agentVersion,
          board: d.board,
          tier: d.tier,
          os: d.os,
          mdnsHost: d.mdnsHost,
          lastIp: d.lastIp,
          lastSeen: d.lastSeen,
          fcConnected: d.fcConnected,
          pairedAt: d.pairedAt,
        }))
      );
    }
  }, [myDrones]);

  useEffect(() => {
    return () => {
      useAgentConnectionStore.getState().stopPolling();
    };
  }, []);

  function handleConnect() {
    if (urlInput.trim()) {
      connect(urlInput.trim());
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleConnect();
  }

  function handlePaired(deviceId: string, apiKey: string, url: string) {
    setPairingOpen(false);
    connect(url, apiKey);
  }

  return (
    <div className="flex h-full">
      <FleetSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onOpenPairing={() => setPairingOpen(true)}
      />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Connection bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
          {demo && connected && status ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-status-success" />
              <span className="text-xs text-text-primary font-medium">
                {t("demoAgent")}
              </span>
              <span className="text-xs text-text-tertiary">
                v{status.version}
              </span>
              <span className="text-xs text-text-tertiary">
                {t("tier", { tier: status.board?.tier })}
              </span>
              <span className="text-xs text-text-tertiary">{status.board?.name}</span>
              {cloudMode && (
                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-accent-primary/15 text-accent-primary rounded font-medium">
                  <Cloud size={10} />
                  {t("cloud")}
                </span>
              )}
            </div>
          ) : status ? (
            <>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    headerState === "live" && "bg-status-success",
                    headerState === "stale" && "bg-status-warning animate-pulse",
                    headerState === "offline" && "bg-status-error"
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    headerState === "offline" ? "text-text-tertiary" : "text-text-primary"
                  )}
                >
                  {status.board?.name ?? t("agent")}
                </span>
                <span className="text-xs text-text-tertiary">
                  v{status.version}
                </span>
                <span className="text-xs text-text-tertiary">
                  {t("tier", { tier: status.board?.tier })}
                </span>
                {cloudMode && (
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-accent-primary/15 text-accent-primary rounded font-medium">
                    <Cloud size={10} />
                    Cloud
                  </span>
                )}
                {headerState === "stale" && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-status-warning/15 text-status-warning rounded font-medium uppercase tracking-wide">
                    Stale · last seen {freshness.label}
                  </span>
                )}
                {headerState === "offline" && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-status-error/15 text-status-error rounded font-medium uppercase tracking-wide">
                    Offline · last seen {freshness.label}
                  </span>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {headerState === "offline" && cloudMode && cloudDeviceId && (
                  <button
                    onClick={() => connectCloud(cloudDeviceId)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-accent-primary hover:bg-bg-tertiary rounded transition-colors"
                    title="Re-subscribe to cloud heartbeats for this drone"
                  >
                    <Plug size={12} />
                    Reconnect
                  </button>
                )}
                <button
                  onClick={disconnect}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-status-error hover:bg-bg-tertiary rounded transition-colors"
                >
                  <Unplug size={12} />
                  {t("disconnect")}
                </button>
              </div>
            </>
          ) : (
            <>
              {pairedDrones.length > 0 ? (
                <span className="text-xs text-text-secondary">
                  {t("selectDrone")}
                </span>
              ) : (
                <span className="text-xs text-text-secondary">
                  {t("pairToStart")}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  {t("advanced")}
                  {advancedOpen ? (
                    <ChevronDown size={10} />
                  ) : (
                    <ChevronRight size={10} />
                  )}
                </button>
                {advancedOpen && (
                  <>
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="http://localhost:8080"
                      className="w-56 px-2.5 py-1 text-xs bg-bg-tertiary border border-border-default rounded text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary"
                    />
                    <button
                      onClick={handleConnect}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs bg-accent-primary text-white rounded hover:opacity-90 transition-opacity"
                    >
                      <Plug size={12} />
                      {t("connect")}
                    </button>
                  </>
                )}
                {connectionError && (
                  <span className="text-xs text-status-error">
                    {connectionError}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {status ? (
          <>
            {/* Sub-tab navigation */}
            <div className="flex items-center gap-1 px-4 border-b border-border-default bg-bg-secondary">
              {visibleTabs.map((tabId) => {
                const config = tabConfig[tabId];
                if (!config) return null;
                const Icon = config.icon;
                return (
                  <button
                    key={tabId}
                    onClick={() => setActiveTab(tabId)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors self-stretch -mb-px border-b-2",
                      activeTab === tabId
                        ? "text-accent-primary border-accent-primary"
                        : "text-text-secondary hover:text-text-primary border-transparent"
                    )}
                  >
                    <Icon size={13} />
                    {config.label}
                  </button>
                );
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === "overview" && <AgentOverviewTab />}
              {activeTab === "features" && <FeaturesTab />}
              {activeTab === "system" && <SystemTab />}
              {activeTab === "scripts" && <ScriptsTab />}
            </div>
          </>
        ) : (
          <AgentDisconnectedPage onOpenPairing={() => setPairingOpen(true)} />
        )}
      </div>



      {cloudMode && <CloudStatusBridge />}
      {cloudMode && <CloudCommandResultBridge />}
      {cloudMode && <MqttBridge mqttBrokerUrl={clientConfig?.mqttBrokerUrl} />}
      {/* AgentMavlinkBridge is in CommandShell for cross-tab persistence */}

      <PairingDialog
        open={pairingOpen}
        onClose={() => setPairingOpen(false)}
        onPaired={handlePaired}
      />
    </div>
  );
}
