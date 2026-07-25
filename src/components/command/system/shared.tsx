"use client";

/**
 * Shared primitives for the System tab: peripheral grouping, NPU badge,
 * hardware-scan progress indicator, stat boxes, device cards, and the
 * collapsible-section wrapper.
 *
 * @module components/command/system/shared
 */

import { useState, useEffect } from "react";
import {
  ScanLine,
  Loader2,
  Cpu,
  Camera,
  Radio,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { PeripheralInfo } from "@/lib/agent/types";

// ── Peripheral category config ──

export const CATEGORY_CONFIG: Record<string, { color: string; label: string }> = {
  sensor: { color: "border-blue-500 bg-blue-500/10 text-blue-400", label: "sensor" },
  camera: { color: "border-green-500 bg-green-500/10 text-green-400", label: "camera" },
  codec: { color: "border-orange-500 bg-orange-500/10 text-orange-400", label: "codec" },
  isp: { color: "border-cyan-500 bg-cyan-500/10 text-cyan-400", label: "isp" },
  decoder: { color: "border-pink-500 bg-pink-500/10 text-pink-400", label: "decoder" },
  video: { color: "border-yellow-500 bg-yellow-500/10 text-yellow-400", label: "radio" },
  workstation: { color: "border-gray-500 bg-gray-500/10 text-gray-400", label: "Workstation" },
};

// ── NPU Badge (for hero card) ──

// ── Small components and helpers ──

export function NpuBadge() {
  const npuAvailable = useAgentCapabilitiesStore((s) => s.compute.npu_available);
  const npuTops = useAgentCapabilitiesStore((s) => s.compute.npu_tops);
  const npuRuntime = useAgentCapabilitiesStore((s) => s.compute.npu_runtime);
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);

  if (!loaded) return null;

  if (!npuAvailable) {
    return (
      <p className="text-[11px] text-text-tertiary mt-0.5 flex items-center gap-1">
        <Cpu size={10} />
        NPU: Not available
      </p>
    );
  }

  return (
    <p className="text-[11px] text-status-success mt-0.5 flex items-center gap-1">
      <Cpu size={10} />
      NPU: {npuTops} TOPS ({npuRuntime?.toUpperCase()})
    </p>
  );
}

// ── Scan progress animation ──

export const SCAN_STEPS = [
  { label: "USB devices", icon: Usb },
  { label: "Flight controllers", icon: Gauge },
  { label: "Cameras", icon: Camera },
  { label: "Radio links", icon: Radio },
  { label: "Modems & network", icon: Wifi },
] as const;

export function ScanProgress() {
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

/** A single stat tile. A `value` of `undefined` means the node reported no
 * figure, which renders as "--" with no threshold colouring — there is no
 * measurement to compare against a threshold (Rule 44). */
export function StatBox({ label, value, unit, warn }: { label: string; value: number | undefined; unit: string; warn?: boolean }) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center px-3 py-1.5 rounded bg-bg-primary/60 min-w-[60px]",
      warn && "ring-1 ring-status-warning/30"
    )}>
      <span className={cn(
        "text-sm font-mono font-semibold",
        value == null ? "text-text-tertiary" : warn ? "text-status-warning" : value > 80 ? "text-status-error" : "text-text-primary"
      )}>
        {value != null ? `${value.toFixed(0)}${unit}` : "--"}
      </span>
      <span className="text-[9px] uppercase tracking-wider text-text-tertiary">{label}</span>
    </div>
  );
}

/** Fallback badge for a device whose `category` is not one of the known keys —
 * guarantees `cat` is always defined so an unknown/missing category renders a
 * neutral badge instead of crashing the whole Health tab (Rule 44: degrade, do
 * not fabricate; here, degrade instead of throw). */
const DEFAULT_CATEGORY = {
  color: "border-gray-500 bg-gray-500/10 text-gray-400",
  label: "device",
} as const;

export function DeviceCard({ device }: { device: PeripheralInfo }) {
  const cat = CATEGORY_CONFIG[device.category] ?? {
    ...DEFAULT_CATEGORY,
    label: device.category || DEFAULT_CATEGORY.label,
  };
  const endpointCount = (device as unknown as Record<string, unknown>).endpoint_count as number | undefined;
  return (
    <div className="border border-border-default rounded-lg p-3 bg-bg-secondary hover:border-border-strong transition-colors">
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

export function CollapsibleSection({
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
