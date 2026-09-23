"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plug } from "lucide-react";
import { WebSocketTransport } from "@/lib/protocol/transport/websocket";
import { connectWithDetection } from "@/lib/protocol/connect-with-detection";
import { useDroneManager } from "@/stores/drone-manager";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { nodeIdForDevice, resolveNodeId } from "@/lib/agent/node-id";
import { pairedAgentDeviceIdForUrl } from "@/lib/agent/paired-agent-match";
import { getFreshness, useClockTick } from "@/lib/agent/freshness";
import { saveRecentConnection } from "@/lib/recent-connections";
import { getPreset } from "@/lib/presets/presets";
import { BuildPresetPicker } from "./BuildPresetPicker";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { cmdDroneStatusApi } from "@/lib/community-api-drones";
import { useAuthStore } from "@/stores/auth-store";

/**
 * WebSocket ports the SITL tool serves drones #1-#5 on (each drone's SITL TCP
 * port, base 5760, +10 per drone). The tool binds them on the IPv6 loopback.
 */
const SITL_PORTS = [5760, 5770, 5780, 5790, 5800];

const QUICK_PRESETS = [
  { label: "mavlink-router", url: "ws://localhost:14550" },
  ...SITL_PORTS.map((port, i) => ({ label: `SITL #${i + 1}`, url: `ws://[::1]:${port}` })),
];

/** Cloud-status row shape projected for the discovered-rigs section. */
type DiscoveredRig = {
  deviceId: string;
  name: string;
  mavlinkWs: string;
};

/**
 * The paired agent that already owns the flight controller behind a URL, or
 * null when the URL is free to dial directly. An agent's FC belongs to its
 * agent card: a second, direct session to it would put two command-capable
 * rows on one aircraft.
 */
function owningAgent(url: string, rigDeviceId: string | null): string | null {
  const byHost = pairedAgentDeviceIdForUrl(url);
  if (byHost) return byHost;
  if (!rigDeviceId) return null;
  const lanPaired = useLocalNodesStore
    .getState()
    .nodes.some((n) => n.deviceId === rigDeviceId);
  const attached = useDroneManager.getState().drones.has(nodeIdForDevice(rigDeviceId));
  return lanPaired || attached ? rigDeviceId : null;
}

/**
 * Classify a URL that points at a local SITL bridge port. The bridge refuses
 * any connection without the `?token=` it prints at startup, so a SITL URL
 * without one cannot connect. Null when the URL is not a SITL bridge URL.
 */
function sitlTarget(url: string): { tokened: boolean } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (!loopback || !SITL_PORTS.includes(Number(parsed.port))) return null;
  return { tokened: Boolean(parsed.searchParams.get("token")) };
}

export function WebSocketPanel({
  onConnected,
  url,
  onUrlChange,
  targetDroneId,
  connectDisabled = false,
}: {
  /** Called after a successful connect or link attach so the host can close. */
  onConnected?: () => void;
  url?: string;
  onUrlChange?: (url: string) => void;
  /** When set, connects this transport as an additional link to the existing drone (multi-link mode). */
  targetDroneId?: string | null;
  /** Blocks the connect action (link mode with no target drone chosen yet). */
  connectDisabled?: boolean;
}) {
  const t = useTranslations("connect");
  const [localUrl, setLocalUrl] = useState("ws://localhost:14550");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  /** The discovered rig whose URL the operator picked, until they edit it. */
  const [rigDeviceId, setRigDeviceId] = useState<string | null>(null);
  const addDrone = useDroneManager((s) => s.addDrone);
  const attachLinkToDrone = useDroneManager((s) => s.attachLinkToDrone);

  // Discovered rigs: the cloud heartbeat from every paired agent carries a
  // LAN-routable MAVLink WebSocket URL. Only agents heard from recently are
  // offered; a stale row's address may no longer be this agent at all. The
  // query is auth-scoped, so it runs only for a signed-in operator.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const cloudRows = useConvexSkipQuery(cmdDroneStatusApi.listMyCloudStatuses, {
    enabled: isAuthenticated,
  });
  // Re-evaluate the freshness filter on the shared 1 Hz clock.
  useClockTick();
  const discoveredRigs: DiscoveredRig[] = [];
  if (Array.isArray(cloudRows)) {
    for (const row of cloudRows as Array<{
      drone?: { deviceId?: string; name?: string; lastSeen?: number };
      status?: {
        manualConnectionUrls?: { mavlinkWs?: string | null };
      } | null;
    }>) {
      const ws = row?.status?.manualConnectionUrls?.mavlinkWs;
      const deviceId = row?.drone?.deviceId;
      const live = getFreshness(row?.drone?.lastSeen ?? null).state === "live";
      if (live && typeof ws === "string" && ws && typeof deviceId === "string") {
        discoveredRigs.push({
          deviceId,
          name: row?.drone?.name || deviceId,
          mavlinkWs: ws,
        });
      }
    }
  }

  const effectiveUrl = url ?? localUrl;

  const handleUrlChange = (next: string, rig: string | null = null) => {
    setLocalUrl(next);
    setRigDeviceId(rig);
    // A build preset only names a SITL vehicle; it must never follow the
    // operator onto a real vehicle's URL.
    if (!sitlTarget(next)) setSelectedPresetId(null);
    onUrlChange?.(next);
  };

  const sitl = useMemo(() => sitlTarget(effectiveUrl), [effectiveUrl]);
  const needsSitlToken = sitl !== null && !sitl.tokened;

  async function handleConnect() {
    setError(null);
    const trimmed = effectiveUrl.trim();

    if (!trimmed) {
      setError(t("ws.urlRequired"));
      return;
    }
    if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
      setError(t("ws.urlScheme"));
      return;
    }
    if (owningAgent(trimmed, rigDeviceId)) {
      setError(t("ownedByAgent"));
      return;
    }

    setConnecting(true);
    let transport: WebSocketTransport | null = null;
    let handedOff = false;
    try {
      transport = new WebSocketTransport();
      await transport.connect(trimmed);

      // Multi-link mode: attach as secondary link to existing drone
      if (targetDroneId) {
        const result = await attachLinkToDrone(targetDroneId, transport);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        handedOff = true;
        onConnected?.();
        return;
      }

      const { adapter, vehicleInfo, firmwareType } =
        await connectWithDetection(transport);
      const droneId = resolveNodeId();

      // A build preset names a SITL vehicle; the firmware string names
      // anything else. Append system ID for unique naming in multi-drone setups.
      const preset =
        selectedPresetId && sitlTarget(trimmed) ? getPreset(selectedPresetId) : null;
      const sysIdSuffix = vehicleInfo.systemId > 0 ? ` #${vehicleInfo.systemId}` : '';
      const droneName = preset
        ? `${preset.name}${sysIdSuffix}`
        : `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})${sysIdSuffix}`;

      addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
        type: "websocket",
        url: trimmed,
        firmwareType,
      });
      handedOff = true;

      void saveRecentConnection({
        type: "websocket",
        url: trimmed,
        firmwareType,
        name: droneName,
        date: Date.now(),
      });

      onConnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("connectionFailed"));
    } finally {
      // Tear down a socket the drone manager did not take, so a failed
      // connect or a refused link attach never leaks it.
      if (transport && !handedOff) {
        try {
          await transport.disconnect();
        } catch {
          /* ignore */
        }
      }
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Input
        label={t("ws.urlLabel")}
        value={effectiveUrl}
        onChange={(e) => {
          handleUrlChange(e.target.value);
          setError(null);
        }}
        placeholder="ws://localhost:14550"
      />

      {discoveredRigs.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-text-tertiary mb-1.5">
            {t("ws.discoveredRigs")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {discoveredRigs.map((rig) => (
              <button
                key={rig.deviceId}
                onClick={() => handleUrlChange(rig.mavlinkWs, rig.deviceId)}
                className={`px-2 py-1 text-[10px] font-mono border transition-colors cursor-pointer ${
                  effectiveUrl === rig.mavlinkWs
                    ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                    : "border-border-default text-text-tertiary hover:text-text-secondary hover:border-border-strong"
                }`}
                title={rig.mavlinkWs}
              >
                {rig.name} — {rig.mavlinkWs.replace(/^wss?:\/\//, "")}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick-connect presets */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PRESETS.map((preset) => (
          <button
            key={preset.url}
            onClick={() => handleUrlChange(preset.url)}
            className={`px-2 py-1 text-[10px] font-mono border transition-colors cursor-pointer ${
              effectiveUrl === preset.url
                ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                : "border-border-default text-text-tertiary hover:text-text-secondary hover:border-border-strong"
            }`}
          >
            {preset.label} — {preset.url.replace("ws://", "")}
          </button>
        ))}
      </div>

      {/* Build preset picker — shown when SITL URL detected */}
      {sitl && (
        <BuildPresetPicker
          selectedPresetId={selectedPresetId}
          onSelect={setSelectedPresetId}
        />
      )}

      {needsSitlToken && (
        <p className="text-[10px] text-status-warning">
          {t("ws.sitlTokenHint", { example: "ws://[::1]:5760/?token=…" })}
        </p>
      )}

      <Button
        onClick={handleConnect}
        loading={connecting}
        disabled={needsSitlToken || connectDisabled}
        icon={<Plug size={14} />}
      >
        {connecting ? t("connecting") : t("connect")}
      </Button>

      <p className="text-[10px] text-text-tertiary">
        {t("ws.rawEndpointHint")}
      </p>

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
