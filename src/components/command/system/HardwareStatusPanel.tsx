"use client";

/**
 * @module HardwareStatusPanel
 * @description SBC hero card, board pinout, calibration launcher, and grouped
 * peripheral cards. Auto-scans peripherals on connect and exposes a manual
 * Scan Now action.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ScanLine,
  Loader2,
  Cpu,
  Wifi,
  WifiOff,
  AlertTriangle,
  Clock,
  HardDrive,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";
import {
  deriveMavlinkLink,
  fcLinkRemediation,
  heartbeatAgeLabel,
} from "@/lib/agent/mavlink-link";
import { fcFirmwareLabel } from "@/lib/protocol/fc-firmware-label";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { BoardPinoutView } from "../shared/BoardPinoutView";
import { CategoryFilter } from "../shared/CategoryFilter";
import { CalibrationLauncher } from "./CalibrationLauncher";
import {
  CollapsibleSection,
  DeviceCard,
  NpuBadge,
  ScanProgress,
  StatBox,
} from "./shared";
import type { InstallStatus, WfbModuleSource } from "@/lib/agent/types";

type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

const WFB_MODULE_VARIANT: Record<WfbModuleSource, BadgeVariant> = {
  prebuilt: "success",
  dkms: "success",
  none: "neutral",
};

const WFB_MODULE_LABEL: Record<WfbModuleSource, string> = {
  prebuilt: "Radio module: Prebuilt",
  dkms: "Radio module: Built on-device",
  none: "Radio module: Not loaded",
};

function wfbModuleLabel(source: WfbModuleSource | string): string {
  if (source in WFB_MODULE_LABEL) {
    return WFB_MODULE_LABEL[source as WfbModuleSource];
  }
  // Forward-compat: unknown value from a future agent version — title-case and show it.
  const display = source.charAt(0).toUpperCase() + source.slice(1);
  return `Radio module: ${display}`;
}

function wfbModuleVariant(source: WfbModuleSource | string): BadgeVariant {
  if (source in WFB_MODULE_VARIANT) {
    return WFB_MODULE_VARIANT[source as WfbModuleSource];
  }
  return "neutral";
}

const INSTALL_STATUS_VARIANT: Record<InstallStatus, BadgeVariant> = {
  ok: "success",
  degraded: "warning",
  failed: "error",
  unknown: "neutral",
};

const INSTALL_STATUS_LABEL: Record<InstallStatus, string> = {
  ok: "Install OK",
  degraded: "Install degraded",
  failed: "Install failed",
  unknown: "Install unknown",
};

export function HardwareStatusPanel() {
  const t = useTranslations("agent");
  const connected = useAgentConnectionStore((s) => s.connected);
  const peripherals = useAgentPeripheralsStore((s) => s.peripherals);
  const scanPeripherals = useAgentPeripheralsStore((s) => s.scanPeripherals);
  const status = useAgentSystemStore((s) => s.status);
  const resources = useAgentSystemStore((s) => s.resources);
  const cpuHistory = useAgentSystemStore((s) => s.cpuHistory);

  const [hwScanning, setHwScanning] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    if (connected && peripherals.length === 0) {
      setHwScanning(true);
      scanPeripherals();
    }
  }, [connected, peripherals.length, scanPeripherals]);

  useEffect(() => {
    if (peripherals.length > 0) setHwScanning(false);
  }, [peripherals.length]);

  // Category chips (All / Compute / Video / ...) derived from the live device
  // set so the operator can filter a flat browse of everything the agent found.
  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of peripherals) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return [
      { id: "all", label: "All", count: peripherals.length },
      ...Object.entries(counts).map(([id, count]) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        count,
      })),
    ];
  }, [peripherals]);

  const filtered = useMemo(
    () =>
      activeCategory === "all"
        ? peripherals
        : peripherals.filter((p) => p.category === activeCategory),
    [peripherals, activeCategory],
  );

  // Undefined when the node reported no reading. A tile showing 0% for an
  // unreported metric is indistinguishable from a genuinely idle board, so an
  // absent figure renders "--" instead.
  const cpuPct = resources?.cpu_percent;
  const memPct = resources?.memory_percent;
  const diskPct = resources?.disk_percent;
  const temp = resources?.temperature ?? null;
  // Gated FC truth, same as AgentStatusCard: a bare fc_connected only means
  // "transport open", so derive alive / silent / down distinctly. A silent
  // link (port open, no MAVLink) shows amber plus an actionable remediation.
  const link = deriveMavlinkLink(status);
  const fcConnected = link.state === "alive";
  const fcMsp = link.state === "msp";
  const fcSilent = link.state === "silent";
  // An identified MSP FC (Betaflight/iNav) reads as connected, labelled by
  // firmware — reachable + drivable over the MSP proxy, never amber "no MAVLink".
  const fcMspLabel = fcMsp
    ? `${fcFirmwareLabel(status?.fc_firmware, status?.fc_variant) ?? "FC"} (MSP)`
    : null;
  const remediation = fcSilent ? fcLinkRemediation(status) : null;
  // Board pinout + calibration need a real live link, not just an open port.
  const fcLive = fcConnected;
  const uptimeSeconds = status?.uptime_seconds || cpuHistory.length * 5;

  // Declared-vs-probed SoC drift. Only flag when both are present and the
  // probed (kernel) value disagrees with what the board profile declared.
  const socDeclared = status?.board?.soc_declared;
  const socProbed = status?.board?.soc_probed;
  const socDrift = Boolean(
    socDeclared && socProbed && socDeclared !== socProbed,
  );

  async function handleHwScan() {
    setHwScanning(true);
    await scanPeripherals();
    setTimeout(() => setHwScanning(false), 15000);
  }

  return (
    <CollapsibleSection
      title="Hardware"
      icon={Cpu}
      defaultOpen={true}
      badge={peripherals.length > 0 ? peripherals.length : undefined}
    >
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

      {status && (
        <div className="border-t-2 border-t-accent-primary border border-border-default rounded-lg p-4 bg-bg-secondary">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
                <Cpu size={16} className="text-accent-primary" />
                {status.board?.name || "Unknown SBC"}
              </h2>
              <p className="text-xs text-text-tertiary mt-0.5">
                {status.board?.soc} · {status.board?.arch}
                {status.board?.tier != null ? ` · Tier ${status.board.tier}` : ""}
                {status.board?.cpu_cores ? ` · ${status.board.cpu_cores} cores` : ""}
                {status.board?.ram_mb ? ` · ${status.board.ram_mb} MB RAM` : ""}
              </p>
              {socDrift && (
                <Tooltip
                  multiline
                  content={
                    <div className="space-y-1">
                      <p className="text-xs text-text-secondary">
                        The board profile declares a different SoC than the
                        running kernel reports. Showing the probed value.
                      </p>
                      <p className="text-xs font-mono text-text-tertiary">
                        Declared {status.board?.soc_declared}
                      </p>
                      <p className="text-xs font-mono text-text-tertiary">
                        Probed {status.board?.soc_probed}
                      </p>
                    </div>
                  }
                >
                  <Badge variant="warning">SoC: declared/probed differ</Badge>
                </Tooltip>
              )}
              {(status.board?.cpu_probed || status.board?.hw_encoder_probed) && (
                <p className="text-[11px] font-mono text-text-tertiary mt-0.5">
                  {status.board?.cpu_probed ? `Probed ${status.board.cpu_probed}` : ""}
                  {status.board?.cpu_probed && status.board?.hw_encoder_probed ? " · " : ""}
                  {status.board?.hw_encoder_probed
                    ? `HW encoder ${status.board.hw_encoder_probed}`
                    : ""}
                </p>
              )}
              {status.kernel_release && (
                <p className="text-[11px] font-mono text-text-tertiary mt-0.5">
                  Kernel {status.kernel_release}
                </p>
              )}
              <NpuBadge />
              {(status.wfb_module_source || status.install_status) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {status.wfb_module_source && (
                    <Badge variant={wfbModuleVariant(status.wfb_module_source)}>
                      {wfbModuleLabel(status.wfb_module_source)}
                    </Badge>
                  )}
                  {status.install_status &&
                    ((status.install_status === "degraded" ||
                      status.install_status === "failed") &&
                    status.failed_steps &&
                    status.failed_steps.length > 0 ? (
                      <Tooltip
                        multiline
                        content={
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-text-primary">
                              Failed steps
                            </p>
                            <ul className="text-xs text-text-secondary list-disc pl-4 space-y-0.5">
                              {status.failed_steps.map((step) => (
                                <li key={step} className="font-mono break-words">
                                  {step}
                                </li>
                              ))}
                            </ul>
                          </div>
                        }
                      >
                        <Badge variant={INSTALL_STATUS_VARIANT[status.install_status]}>
                          {INSTALL_STATUS_LABEL[status.install_status]}
                        </Badge>
                      </Tooltip>
                    ) : (
                      <Badge variant={INSTALL_STATUS_VARIANT[status.install_status]}>
                        {INSTALL_STATUS_LABEL[status.install_status]}
                      </Badge>
                    ))}
                  {status.install_version && (
                    <span className="text-[10px] font-mono text-text-tertiary">
                      build {status.install_version}
                    </span>
                  )}
                </div>
              )}
            </div>
            <span className="text-xs font-mono text-text-tertiary">v{status.version}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <StatBox label="CPU" value={cpuPct} unit="%" warn={cpuPct != null && cpuPct > 80} />
            <StatBox label="MEM" value={memPct} unit="%" warn={memPct != null && memPct > 85} />
            <StatBox label="DISK" value={diskPct} unit="%" warn={diskPct != null && diskPct > 90} />
            {temp != null && <StatBox label="TEMP" value={temp} unit="°" warn={temp > 70} />}
          </div>

          <div className="flex items-center gap-4 text-xs border-t border-border-default pt-2">
            <div className="flex items-center gap-1.5">
              {fcConnected || fcMsp ? (
                <Wifi size={12} className="text-status-success" />
              ) : fcSilent ? (
                <AlertTriangle size={12} className="text-status-warning" />
              ) : (
                <WifiOff size={12} className="text-status-error" />
              )}
              <span
                className={
                  fcConnected || fcMsp
                    ? "text-status-success"
                    : fcSilent
                      ? "text-status-warning"
                      : "text-status-error"
                }
              >
                {fcConnected
                  ? t("fcConnected")
                  : fcMsp
                    ? fcMspLabel
                    : fcSilent
                      ? t("fcLink.portOpenNoMavlink")
                      : t("fcDisconnected")}
              </span>
            </div>
            {/* Heartbeat age — the real liveness proof, shown whenever the
                agent ships the gated truth so a silent port reads honestly. */}
            {link.hasGatedTruth && !fcMsp && (
              <span
                className={
                  link.mavlinkAlive
                    ? "text-text-tertiary"
                    : "text-status-warning"
                }
                title="Time since the last decoded MAVLink HEARTBEAT"
              >
                {link.mavlinkAlive
                  ? `MAVLink ${heartbeatAgeLabel(link.heartbeatAgeS)}`
                  : t("fcLink.noHeartbeat")}
              </span>
            )}
            <div className="flex items-center gap-1.5 text-text-tertiary">
              <Clock size={12} />
              <span>Uptime {formatDuration(uptimeSeconds)}</span>
            </div>
          </div>

          {remediation && (
            <div className="flex items-start gap-1.5 text-[11px] mt-2 px-2 py-1 rounded bg-status-warning/10 text-status-warning">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{t(remediation.key, remediation.values)}</span>
            </div>
          )}
        </div>
      )}

      {fcLive && <BoardPinoutView />}

      {fcLive && <CalibrationLauncher />}

      {hwScanning && peripherals.length === 0 && <ScanProgress />}

      {peripherals.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive size={14} className="text-text-tertiary" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Peripherals
            </h4>
            <span className="text-[10px] text-text-tertiary bg-bg-primary px-1.5 py-0.5 rounded">
              {peripherals.length}
            </span>
          </div>
          <CategoryFilter
            categories={categories}
            active={activeCategory}
            onChange={setActiveCategory}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((device, i) => (
              <DeviceCard key={`${device.bus}-${device.address}-${i}`} device={device} />
            ))}
          </div>
        </div>
      )}

      {!hwScanning && peripherals.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sm text-text-tertiary">No peripherals detected</p>
          <p className="text-xs text-text-tertiary mt-1">Click Scan Now to discover connected hardware</p>
        </div>
      )}
    </CollapsibleSection>
  );
}
