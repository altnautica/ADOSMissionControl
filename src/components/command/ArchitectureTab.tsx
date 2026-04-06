"use client";

/**
 * @module ArchitectureTab
 * @description Hardware architecture view showing the drone's SBC and connected peripherals
 * in grouped card-based sections. Replaces PeripheralsTab with better organization.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useMemo } from "react";
import {
  ScanLine,
  Loader2,
  Cpu,
  Camera,
  MonitorPlay,
  Radio,
  HardDrive,
  Gauge,
  Thermometer,
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
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import type { PeripheralInfo } from "@/lib/agent/types";

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
  // Filter out root hubs
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
      {/* Keyframe for checkmark scale-in */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes scan-check {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      ` }} />
    </div>
  );
}

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

export function ArchitectureTab() {
  const connected = useAgentConnectionStore((s) => s.connected);
  const peripherals = useAgentPeripheralsStore((s) => s.peripherals);
  const scanPeripherals = useAgentPeripheralsStore((s) => s.scanPeripherals);
  const status = useAgentSystemStore((s) => s.status);
  const resources = useAgentSystemStore((s) => s.resources);
  const services = useAgentSystemStore((s) => s.services);
  const cpuHistory = useAgentSystemStore((s) => s.cpuHistory);

  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (connected && peripherals.length === 0) {
      setScanning(true);
      scanPeripherals();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (peripherals.length > 0) setScanning(false);
  }, [peripherals.length]);

  const groups = useMemo(() => groupPeripherals(peripherals), [peripherals]);

  const cpuPct = resources?.cpu_percent ?? 0;
  const memPct = resources?.memory_percent ?? 0;
  const diskPct = resources?.disk_percent ?? 0;
  const temp = resources?.temperature ?? 0;
  const fcConnected = status?.fc_connected || services.some((s) => s.name === "ados-mavlink" && s.status === "running");
  const uptimeSeconds = status?.uptime_seconds || cpuHistory.length * 5;

  async function handleScan() {
    setScanning(true);
    await scanPeripherals();
    setTimeout(() => setScanning(false), 15000);
  }

  if (!connected) return <AgentDisconnectedPage />;

  return (
    <div className="p-4 space-y-4 max-w-5xl overflow-y-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Hardware Architecture
        </h3>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
        >
          {scanning ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
          {scanning ? "Scanning..." : "Scan Now"}
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

      {/* Loading */}
      {scanning && peripherals.length === 0 && <ScanProgress />}

      {/* Grouped Sections */}
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

      {!scanning && peripherals.length === 0 && (
        <div className="text-center py-16">
          <p className="text-sm text-text-tertiary">No peripherals detected</p>
          <p className="text-xs text-text-tertiary mt-1">Click Scan Now to discover connected hardware</p>
        </div>
      )}
    </div>
  );
}
