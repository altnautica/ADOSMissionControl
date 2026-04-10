"use client";

/**
 * @module SystemTab
 * @description Unified system view merging Hardware (ArchitectureTab), Services, and Fleet Network
 * into collapsible sections. Replaces separate ArchitectureTab and FleetNetworkTab.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  ScanLine,
  Loader2,
  Cpu,
  Camera,
  MonitorPlay,
  Radio,
  HardDrive,
  Gauge,
  Wifi,
  WifiOff,
  Clock,
  Check,
  Usb,
  Circle,
  Compass,
  Activity,
  RotateCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Server,
  Network,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentScriptsStore } from "@/stores/agent-scripts-store";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { BoardPinoutView } from "./shared/BoardPinoutView";
import { ServiceTable } from "./shared/ServiceTable";
import { DroneNetEnrollmentCard } from "./shared/DroneNetEnrollmentCard";
import type { PeripheralInfo } from "@/lib/agent/types";

// ── Category colors for peripheral cards ──

const CATEGORY_CONFIG: Record<string, { color: string; label: string }> = {
  sensor: { color: "border-blue-500 bg-blue-500/10 text-blue-400", label: "sensor" },
  camera: { color: "border-green-500 bg-green-500/10 text-green-400", label: "camera" },
  codec: { color: "border-orange-500 bg-orange-500/10 text-orange-400", label: "codec" },
  isp: { color: "border-cyan-500 bg-cyan-500/10 text-cyan-400", label: "isp" },
  decoder: { color: "border-pink-500 bg-pink-500/10 text-pink-400", label: "decoder" },
  video: { color: "border-yellow-500 bg-yellow-500/10 text-yellow-400", label: "radio" },
  compute: { color: "border-gray-500 bg-gray-500/10 text-gray-400", label: "compute" },
};

interface DeviceGroup {
  title: string;
  icon: typeof Cpu;
  devices: PeripheralInfo[];
}

function groupPeripherals(peripherals: PeripheralInfo[]): DeviceGroup[] {
  const filtered = peripherals.filter(
    (p) => !p.name.toLowerCase().includes("root hub")
  );

  const fc = filtered.filter((p) => p.category === "sensor");
  const cameras = filtered.filter((p) => p.category === "camera");
  const videoHw = filtered.filter((p) =>
    ["codec", "isp", "decoder"].includes(p.category)
  );
  const radios = filtered.filter((p) => p.category === "video");
  const other = filtered.filter((p) => p.category === "compute");

  const groups: DeviceGroup[] = [];
  if (fc.length > 0) groups.push({ title: "Flight Controller", icon: Gauge, devices: fc });
  if (cameras.length > 0) groups.push({ title: "Cameras", icon: Camera, devices: cameras });
  if (videoHw.length > 0) groups.push({ title: "Video Hardware", icon: MonitorPlay, devices: videoHw });
  if (radios.length > 0) groups.push({ title: "Radio Links", icon: Radio, devices: radios });
  if (other.length > 0) groups.push({ title: "Other Peripherals", icon: HardDrive, devices: other });
  return groups;
}

// ── Scan progress animation ──

const SCAN_STEPS = [
  { label: "USB devices", icon: Usb },
  { label: "Flight controllers", icon: Gauge },
  { label: "Cameras", icon: Camera },
  { label: "Radio links", icon: Radio },
  { label: "Modems & network", icon: Wifi },
] as const;

function ScanProgress() {
  const [completedStep, setCompletedStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCompletedStep((prev) => {
        if (prev >= SCAN_STEPS.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-12 gap-1">
      <p className="text-sm font-medium text-text-secondary mb-4">Scanning hardware...</p>
      <div className="flex flex-col gap-2.5 w-56">
        {SCAN_STEPS.map((step, i) => {
          const done = i < completedStep;
          const active = i === completedStep;
          const StepIcon = step.icon;

          return (
            <div
              key={step.label}
              className={cn(
                "flex items-center gap-3 text-sm transition-all duration-300",
                done && "text-status-success",
                active && "text-accent-primary",
                !done && !active && "text-text-tertiary opacity-40"
              )}
            >
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                {done ? (
                  <Check size={16} style={{ animation: "scan-check 0.3s ease-out" }} />
                ) : active ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Circle size={14} />
                )}
              </div>
              <StepIcon size={14} className="shrink-0" />
              <span className={cn(active && "animate-pulse")}>{step.label}</span>
            </div>
          );
        })}
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes scan-check {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      ` }} />
    </div>
  );
}

// ── Small reusable pieces ──

function StatBox({ label, value, unit, warn }: { label: string; value: number; unit: string; warn?: boolean }) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center px-3 py-1.5 rounded bg-bg-primary/60 min-w-[60px]",
      warn && "ring-1 ring-status-warning/30"
    )}>
      <span className={cn(
        "text-sm font-mono font-semibold",
        warn ? "text-status-warning" : value > 80 ? "text-status-error" : "text-text-primary"
      )}>
        {value.toFixed(0)}{unit}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-text-tertiary">{label}</span>
    </div>
  );
}

function DeviceCard({ device }: { device: PeripheralInfo }) {
  const cat = CATEGORY_CONFIG[device.category] || CATEGORY_CONFIG.compute;
  const endpointCount = (device as unknown as Record<string, unknown>).endpoint_count as number | undefined;
  return (
    <div className="border border-border-default rounded-lg p-3 bg-bg-secondary hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{device.name}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", cat.color)}>
              {cat.label}
            </span>
            <span className="text-[10px] text-text-tertiary">{device.type}</span>
            {endpointCount && endpointCount > 1 && (
              <span className="text-[10px] text-text-tertiary bg-bg-primary px-1.5 py-0.5 rounded">
                {endpointCount} endpoints
              </span>
            )}
          </div>
        </div>
        <div className={cn(
          "w-2 h-2 rounded-full mt-1 shrink-0",
          device.status === "ok" ? "bg-status-success" : device.status === "warning" ? "bg-status-warning" : "bg-status-error"
        )} />
      </div>
      <div className="space-y-0.5 text-[11px]">
        {device.address && device.address !== device.bus && (
          <div className="flex justify-between">
            <span className="text-text-tertiary">Address</span>
            <span className="text-text-secondary font-mono">{device.address}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-text-tertiary">Bus</span>
          <span className="text-text-secondary font-mono">{device.bus}</span>
        </div>
        {device.last_reading && (
          <div className="flex justify-between">
            <span className="text-text-tertiary">Capabilities</span>
            <span className="text-text-secondary font-mono">{device.last_reading}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsible section wrapper ──

function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  icon: typeof Cpu;
  defaultOpen?: boolean;
  badge?: string | number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border-default rounded-lg bg-bg-secondary overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-bg-primary/40 transition-colors"
      >
        {open ? (
          <ChevronDown size={14} className="text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-text-tertiary shrink-0" />
        )}
        <Icon size={14} className="text-text-secondary shrink-0" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex-1">
          {title}
        </h3>
        {badge !== undefined && (
          <span className="text-[10px] text-text-tertiary bg-bg-primary px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </div>
  );
}

// ── Main component ──

export function SystemTab() {
  const t = useTranslations("fleetNetwork");
  const connected = useAgentConnectionStore((s) => s.connected);
  const mqttConnected = useAgentConnectionStore((s) => s.mqttConnected);

  // Hardware state
  const peripherals = useAgentPeripheralsStore((s) => s.peripherals);
  const scanPeripherals = useAgentPeripheralsStore((s) => s.scanPeripherals);
  const status = useAgentSystemStore((s) => s.status);
  const resources = useAgentSystemStore((s) => s.resources);
  const services = useAgentSystemStore((s) => s.services);
  const cpuHistory = useAgentSystemStore((s) => s.cpuHistory);
  const restartService = useAgentSystemStore((s) => s.restartService);


  // Fleet state
  const peers = useAgentScriptsStore((s) => s.peers);
  const fetchPeers = useAgentScriptsStore((s) => s.fetchPeers);

  const [hwScanning, setHwScanning] = useState(false);
  const [peerScanning, setPeerScanning] = useState(false);
  const [lastPeerScan, setLastPeerScan] = useState<Date | null>(null);
  const [showMqttConfig, setShowMqttConfig] = useState(false);
  const [mqttMode, setMqttMode] = useState<"cloud" | "self-hosted">("cloud");
  const [mqttBrokerUrl, setMqttBrokerUrl] = useState("mqtt.altnautica.com");
  const [mqttUsername, setMqttUsername] = useState("");
  const [mqttPassword, setMqttPassword] = useState("");
  const [mqttTls, setMqttTls] = useState(true);
  const [mqttTesting, setMqttTesting] = useState(false);

  // Auto-scan peripherals on connect
  useEffect(() => {
    if (connected && peripherals.length === 0) {
      setHwScanning(true);
      scanPeripherals();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (peripherals.length > 0) setHwScanning(false);
  }, [peripherals.length]);

  // Auto-fetch peers on connect
  useEffect(() => {
    if (connected) fetchPeers();
  }, [connected, fetchPeers]);

  const groups = useMemo(() => groupPeripherals(peripherals), [peripherals]);

  const cpuPct = resources?.cpu_percent ?? 0;
  const memPct = resources?.memory_percent ?? 0;
  const diskPct = resources?.disk_percent ?? 0;
  const temp = resources?.temperature ?? 0;
  const fcConnected = status?.fc_connected ?? false;
  const uptimeSeconds = status?.uptime_seconds || cpuHistory.length * 5;

  async function handleHwScan() {
    setHwScanning(true);
    await scanPeripherals();
    setTimeout(() => setHwScanning(false), 15000);
  }

  async function handlePeerScan() {
    setPeerScanning(true);
    await fetchPeers();
    setLastPeerScan(new Date());
    setPeerScanning(false);
  }

  async function handleTestMqtt() {
    setMqttTesting(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setMqttTesting(false);
  }

  if (!connected) return <AgentDisconnectedPage />;

  return (
    <div className="p-4 space-y-4 max-w-5xl overflow-y-auto">
      {/* ── Section 1: Hardware ── */}
      <CollapsibleSection
        title="Hardware"
        icon={Cpu}
        defaultOpen={true}
        badge={peripherals.length > 0 ? peripherals.length : undefined}
      >
        {/* Scan toolbar */}
        <div className="flex items-center justify-end">
          <button
            onClick={handleHwScan}
            disabled={hwScanning}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
          >
            {hwScanning ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
            {hwScanning ? "Scanning..." : "Scan Now"}
          </button>
        </div>

        {/* SBC Hero Card */}
        {status && (
          <div className="border-t-2 border-t-accent-primary border border-border-default rounded-lg p-4 bg-bg-secondary">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
                  <Cpu size={16} className="text-accent-primary" />
                  {status.board?.name || "Unknown SBC"}
                </h2>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {status.board?.soc} · {status.board?.arch} · Tier {status.board?.tier}
                  {status.board?.cpu_cores ? ` · ${status.board.cpu_cores} cores` : ""}
                  {status.board?.ram_mb ? ` · ${status.board.ram_mb} MB RAM` : ""}
                </p>
              </div>
              <span className="text-xs font-mono text-text-tertiary">v{status.version}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <StatBox label="CPU" value={cpuPct} unit="%" warn={cpuPct > 80} />
              <StatBox label="MEM" value={memPct} unit="%" warn={memPct > 85} />
              <StatBox label="DISK" value={diskPct} unit="%" warn={diskPct > 90} />
              {temp > 0 && <StatBox label="TEMP" value={temp} unit="°" warn={temp > 70} />}
            </div>

            <div className="flex items-center gap-4 text-xs border-t border-border-default pt-2">
              <div className="flex items-center gap-1.5">
                {fcConnected ? (
                  <Wifi size={12} className="text-status-success" />
                ) : (
                  <WifiOff size={12} className="text-status-error" />
                )}
                <span className={fcConnected ? "text-status-success" : "text-status-error"}>
                  FC {fcConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-text-tertiary">
                <Clock size={12} />
                <span>Uptime {formatDuration(uptimeSeconds)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Board Pinout */}
        {fcConnected && <BoardPinoutView />}

        {/* Calibration Quick-Launch */}
        {fcConnected && (
          <div className="border border-border-default rounded-lg p-4 bg-bg-secondary">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
              Sensor Calibration
            </h4>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Accelerometer", icon: Activity, href: "/config?panel=calibration&type=accel" },
                { label: "Compass", icon: Compass, href: "/config?panel=calibration&type=compass" },
                { label: "Gyroscope", icon: RotateCw, href: "/config?panel=calibration&type=gyro" },
                { label: "Level Horizon", icon: Activity, href: "/config?panel=calibration&type=level" },
                { label: "RC Input", icon: Radio, href: "/config?panel=calibration&type=rc" },
              ].map(({ label, icon: Icon, href }) => (
                <a
                  key={label}
                  href={href}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border-default rounded-lg hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors"
                >
                  <Icon size={12} />
                  {label}
                  <ExternalLink size={10} className="text-text-tertiary" />
                </a>
              ))}
            </div>
            <p className="text-[10px] text-text-tertiary mt-2">
              Opens calibration wizard in the Configure tab
            </p>
          </div>
        )}

        {/* Scan progress */}
        {hwScanning && peripherals.length === 0 && <ScanProgress />}

        {/* Grouped peripheral sections */}
        {groups.map((group) => (
          <div key={group.title} className="space-y-2">
            <div className="flex items-center gap-2">
              <group.icon size={14} className="text-text-tertiary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                {group.title}
              </h4>
              <span className="text-[10px] text-text-tertiary bg-bg-primary px-1.5 py-0.5 rounded">
                {group.devices.length}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.devices.map((device, i) => (
                <DeviceCard key={`${device.bus}-${device.address}-${i}`} device={device} />
              ))}
            </div>
          </div>
        ))}

        {!hwScanning && peripherals.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-text-tertiary">No peripherals detected</p>
            <p className="text-xs text-text-tertiary mt-1">Click Scan Now to discover connected hardware</p>
          </div>
        )}
      </CollapsibleSection>

      {/* ── Section 2: Services ── */}
      <CollapsibleSection
        title="Services"
        icon={Server}
        defaultOpen={true}
        badge={services.length > 0 ? services.length : undefined}
      >
        {services.length > 0 ? (
          <ServiceTable
            services={services}
            onRestart={restartService}
            processCpu={resources?.cpu_percent}
            processMemoryMb={resources?.memory_used_mb}
          />
        ) : (
          <p className="text-xs text-text-tertiary py-4 text-center">
            No service data available
          </p>
        )}
      </CollapsibleSection>

      {/* ── Section 3: Fleet Network ── */}
      <CollapsibleSection
        title="Fleet Network"
        icon={Network}
        defaultOpen={false}
        badge={peers.length > 0 ? peers.length : undefined}
      >
        {/* DroneNet Enrollment */}
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
      </CollapsibleSection>
    </div>
  );
}
