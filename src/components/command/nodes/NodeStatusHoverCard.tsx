"use client";

/**
 * @module nodes/NodeStatusHoverCard
 * @description The profile-aware status card shown when the operator hovers a
 * whole sidebar node row (not just a badge). It reads the honest per-node
 * `CommandCloudStatus` (keyed by deviceId) and renders only what is logical for
 * the node's profile:
 *   - drone            → flight-controller link + onboard-computer (SBC) status,
 *                        or an "add a companion" hint on an FC-only drone.
 *   - ground-station   → role + host metrics + services + WFB peer.
 *   - workstation      → compute host metrics + services + cores/RAM.
 * It never fabricates flight data on a non-drone node, and it reads only the
 * per-node cloud status (never the ground-station / compute singleton stores,
 * which reflect only the *selected* node) so a hovered row can't show another
 * node's data (Rule 44).
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  useCommandFleetStore,
  type CommandCloudStatus,
} from "@/stores/command-fleet-store";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { droneLiveness } from "../fleet/types";
import {
  deriveMavlinkLink,
  heartbeatAgeLabel,
  mspFcLabel,
} from "@/lib/agent/mavlink-link";
import { fcFirmwareLabel } from "@/lib/protocol/fc-firmware-label";
import {
  useNodeDisplayName,
  useReachedViaName,
} from "@/lib/nodes/reach-provenance";
import { countRunning } from "@/lib/agent/service-state";

type EffProfile = "drone" | "ground-station" | "workstation";

function effProfile(node: FleetNodeEntry): EffProfile {
  if (node.profile === "ground-station") return "ground-station";
  if (node.profile === "workstation") return "workstation";
  return "drone";
}

function fmtPct(v?: number | null): string {
  return v != null ? `${Math.round(v)}%` : "—";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border-default bg-bg-primary px-1.5 py-1 text-center">
      <p className="text-[8px] uppercase tracking-wider text-text-tertiary">{label}</p>
      <p className="font-mono text-[11px] text-text-primary">{value}</p>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[9px] text-text-secondary">
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[9px] uppercase tracking-wider text-text-tertiary">{children}</p>
  );
}

/** CPU / MEM / TEMP grid, shown only when the node reports host metrics. */
function HostMetrics({
  cpu,
  mem,
  temp,
}: {
  cpu?: number;
  mem?: number;
  temp?: number | null;
}) {
  const t = useTranslations("telemetryStrip");
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <Metric label={t("cpu")} value={fmtPct(cpu)} />
      <Metric label={t("mem")} value={fmtPct(mem)} />
      <Metric label={t("temp")} value={temp != null ? `${Math.round(temp)}°` : "—"} />
    </div>
  );
}

/** The FC link state for this card, from the per-node camelCase cloud fields.
 * The state itself comes from the canonical derivation (which takes the agent's
 * snake_case status), so this only maps that state onto a label and a dot:
 * alive → "FC Connected"; a reachable MSP FC → "<Firmware> (MSP)";
 * transport-open-no-heartbeat → "Port open · no MAVLink"; else "FC
 * Disconnected". */
function fcLinkState(status: {
  fcConnected?: boolean;
  fcVariant?: string;
  fcFirmware?: string;
  transportOpen?: boolean;
  mavlinkAlive?: boolean;
}): { label: string; level: StatusLevel } {
  const link = deriveMavlinkLink({
    // The agent status types fc_connected as a required boolean while the
    // per-node cloud fields leave it absent until a status carries one. The
    // derivation only ever tests this for `=== true`, so an absent flag and an
    // explicit false take the identical path.
    fc_connected: status.fcConnected ?? false,
    transport_open: status.transportOpen,
    mavlink_alive: status.mavlinkAlive,
    fc_variant: status.fcVariant,
  });
  switch (link.state) {
    case "alive":
      return { label: "FC Connected", level: "good" };
    case "msp":
      return {
        label: mspFcLabel(link.state, status.fcFirmware, status.fcVariant) ?? "FC (MSP)",
        level: "good",
      };
    case "silent":
      return { label: "Port open · no MAVLink", level: "warning" };
    case "down":
      return { label: "FC Disconnected", level: "offline" };
  }
}

/** firmware · airframe (e.g. "ArduPilot · Copter"), or null when unknown. */
function flavor(fcFirmware?: string, fcVariant?: string, frameType?: string): string | null {
  const name = fcFirmwareLabel(fcFirmware, fcVariant);
  if (!name) return null;
  return frameType ? `${name} · ${frameType}` : name;
}

export function NodeStatusHoverCard({ node }: { node: FleetNodeEntry }) {
  const status = useCommandFleetStore((s) => s.cloudStatuses[node.deviceId]);
  const profile = effProfile(node);
  const live = droneLiveness(node);

  const typeLabel =
    profile === "ground-station"
      ? "Ground station"
      : profile === "workstation"
        ? "Compute node"
        : "Drone";

  // Offline: an honest single line, never a fabricated fresh reading (Rule 44).
  if (live === "offline") {
    return (
      <div className="w-56 space-y-1">
        <p className="text-xs font-medium text-text-primary">{node.name}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <StatusDot status="offline" size="xs" /> {typeLabel} · Offline
        </p>
      </div>
    );
  }

  const stale = live === "stale";
  const running = status?.services ? countRunning(status.services) : 0;
  const total = status?.services?.length ?? 0;
  const hasHostMetrics =
    status != null &&
    (status.cpuPercent != null ||
      status.memoryPercent != null ||
      status.temperature != null);

  return (
    <div className={`w-64 space-y-2.5 text-left ${stale ? "opacity-70" : ""}`}>
      {stale && (
        <p className="flex items-center gap-1.5 text-[10px] text-status-serious">
          <StatusDot status="serious" size="xs" /> Stale · data unverified
        </p>
      )}

      {profile === "drone" && (
        <DroneBody node={node} status={status} running={running} total={total} />
      )}

      {profile === "ground-station" && (
        <GroundStationBody
          node={node}
          status={status}
          running={running}
          total={total}
          hasHostMetrics={hasHostMetrics}
        />
      )}

      {profile === "workstation" && (
        <WorkstationBody
          node={node}
          status={status}
          running={running}
          total={total}
          hasHostMetrics={hasHostMetrics}
        />
      )}
    </div>
  );
}

/** The WFB reach hop for a transitively-enrolled drone: which ground node it is
 * linked through, and the WFB `-p1` RSSI the ground node heard it at. Honest:
 * an unknown hop / RSSI reads as such, never a confident value (Rule 44). */
function RelayReachSection({
  node,
  status,
}: {
  node: FleetNodeEntry;
  status: CommandCloudStatus | undefined;
}) {
  const t = useTranslations("nodeConsole");
  const gsName = useReachedViaName(node.reachedVia);
  const rssi = status?.peerRssiDbm;
  const gsDisplay =
    gsName ??
    (node.reachedVia?.startsWith("node:")
      ? node.reachedVia.slice("node:".length)
      : (node.reachedVia ?? "—"));
  return (
    <section className="space-y-1 border-b border-border-default pb-2">
      <SectionLabel>{t("provenance.reach")}</SectionLabel>
      <p className="flex items-center gap-1.5 text-[11px] text-text-primary">
        <StatusDot status="idle" size="xs" />
        {t("provenance.linkedViaWfb", { node: gsDisplay })}
      </p>
      <p className="font-mono text-[10px] text-text-tertiary">
        {typeof rssi === "number"
          ? t("provenance.wfbRssi", { rssi })
          : t("provenance.wfbUnverified")}
      </p>
    </section>
  );
}

function DroneBody({
  node,
  status,
  running,
  total,
}: {
  node: FleetNodeEntry;
  status: CommandCloudStatus | undefined;
  running: number;
  total: number;
}) {
  const link = fcLinkState({
    fcConnected: node.fcConnected,
    fcVariant: node.fcVariant,
    fcFirmware: node.fcFirmware,
    transportOpen: node.transportOpen,
    mavlinkAlive: status?.mavlinkAlive,
  });
  const flav = flavor(node.fcFirmware, node.fcVariant, node.frameType);
  const portBaud =
    status?.transportOpen !== false && status?.fcPort
      ? `${status.fcPort}${status.fcBaud ? ` @ ${status.fcBaud}` : ""}`
      : null;
  const hbGated = status?.transportOpen !== undefined || status?.mavlinkAlive !== undefined;
  const showHeartbeat = hbGated && link.level !== "warning" && !link.label.includes("(MSP)");

  const hasCompanion = !!node.board;

  return (
    <>
      {node.reachedVia && <RelayReachSection node={node} status={status} />}
      <section className="space-y-1">
        <SectionLabel>Flight controller</SectionLabel>
        <p className="flex items-center gap-1.5 text-[11px] text-text-primary">
          <StatusDot status={link.level} size="xs" /> {link.label}
        </p>
        {flav && <p className="text-[10px] text-text-tertiary">{flav}</p>}
        {portBaud && (
          <p className="font-mono text-[10px] text-text-tertiary">{portBaud}</p>
        )}
        {showHeartbeat && (
          <p className="font-mono text-[10px] text-text-tertiary">
            MAVLink {heartbeatAgeLabel(status?.heartbeatAgeS ?? null)}
          </p>
        )}
      </section>

      {hasCompanion ? (
        <section className="space-y-2 border-t border-border-default pt-2">
          <div>
            <SectionLabel>Onboard computer</SectionLabel>
            <p className="text-[10px] text-text-tertiary">
              {node.board ?? "Companion"}
              {node.tier != null ? ` · Tier ${node.tier}` : ""}
            </p>
          </div>
          <HostMetrics
            cpu={status?.cpuPercent}
            mem={status?.memoryPercent}
            temp={status?.temperature}
          />
          <p className="text-[10px] text-text-tertiary">
            {running}/{total} services running · video {status?.videoState ?? "—"}
          </p>
          <div className="flex flex-wrap gap-1">
            <Chip>Video</Chip>
            <Chip>Vision</Chip>
            <Chip>World Model</Chip>
            <Chip>Compute</Chip>
          </div>
        </section>
      ) : (
        <p className="border-t border-border-default pt-2 text-[10px] text-text-tertiary">
          No companion computer — pair one to add video, vision, and world model.
        </p>
      )}
    </>
  );
}

function GroundStationBody({
  node,
  status,
  running,
  total,
  hasHostMetrics,
}: {
  node: FleetNodeEntry;
  status: CommandCloudStatus | undefined;
  running: number;
  total: number;
  hasHostMetrics: boolean;
}) {
  const t = useTranslations("nodeConsole");
  const roleLabel =
    node.role === "relay"
      ? "Relay"
      : node.role === "receiver"
        ? "Receiver"
        : "Direct";
  const peer = status?.peerDeviceId;
  const peerRssi = status?.peerRssiDbm;
  const peerName = useNodeDisplayName(peer ?? null);
  const peerDisplay =
    peerName ?? (peer ? `${peer.slice(0, 8)}` : null);

  return (
    <section className="space-y-2">
      <div>
        <SectionLabel>Ground station</SectionLabel>
        <p className="text-[11px] text-text-primary">
          {roleLabel}
          {node.board ? ` · ${node.board}` : ""}
          {node.tier != null ? ` · Tier ${node.tier}` : ""}
        </p>
      </div>
      {hasHostMetrics && (
        <HostMetrics
          cpu={status?.cpuPercent}
          mem={status?.memoryPercent}
          temp={status?.temperature}
        />
      )}
      {total > 0 && (
        <p className="text-[10px] text-text-tertiary">
          {running}/{total} services running
        </p>
      )}
      {peerDisplay && (
        <p className="font-mono text-[10px] text-text-tertiary">
          {t("provenance.relaying", { node: peerDisplay })}
          {peerRssi != null
            ? ` · ${t("provenance.wfbRssi", { rssi: peerRssi })}`
            : ""}
        </p>
      )}
      <p className="text-[9px] text-text-tertiary">
        Open the node {"→"} Radio / Mesh for link + distributed RX.
      </p>
    </section>
  );
}

function WorkstationBody({
  node,
  status,
  running,
  total,
  hasHostMetrics,
}: {
  node: FleetNodeEntry;
  status: CommandCloudStatus | undefined;
  running: number;
  total: number;
  hasHostMetrics: boolean;
}) {
  const cores = status?.cpuCores;
  const ramGb = status?.boardRamMb != null ? Math.round(status.boardRamMb / 1024) : null;

  return (
    <section className="space-y-2">
      <div>
        <SectionLabel>Compute node</SectionLabel>
        <p className="text-[11px] text-text-primary">
          {node.board ?? "Workstation"}
          {node.tier != null ? ` · Tier ${node.tier}` : ""}
        </p>
      </div>
      {hasHostMetrics && (
        <HostMetrics
          cpu={status?.cpuPercent}
          mem={status?.memoryPercent}
          temp={status?.temperature}
        />
      )}
      {(cores != null || ramGb != null) && (
        <p className="font-mono text-[10px] text-text-tertiary">
          {cores != null ? `${cores} cores` : ""}
          {cores != null && ramGb != null ? " · " : ""}
          {ramGb != null ? `${ramGb} GB RAM` : ""}
        </p>
      )}
      {total > 0 && (
        <p className="text-[10px] text-text-tertiary">
          {running}/{total} services running
        </p>
      )}
      <p className="text-[9px] text-text-tertiary">
        Open the node {"→"} Compute for cluster + jobs.
      </p>
    </section>
  );
}
