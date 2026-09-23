/**
 * @module NetEndpointPanel
 * @description Direct UDP / TCP MAVLink connection form. On the desktop app the
 * socket is opened natively; in the browser (which can't open raw sockets) the
 * same form connects through a small local bridge and surfaces the one-line
 * command to start it. Shared by the UDP and TCP method cards via `proto`.
 * @license GPL-3.0-only
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Plug, Copy, Check, ExternalLink, Terminal } from "lucide-react";
import {
  NetMavlinkTransport,
  DEFAULT_BRIDGE_URL,
  type NetProto,
  type UdpMode,
} from "@/lib/protocol/transport/net-mavlink";
import { connectWithDetection } from "@/lib/protocol/connect-with-detection";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { saveRecentConnection } from "@/lib/recent-connections";
import { isElectron } from "@/lib/utils";
import { resolveNodeId } from "@/lib/agent/node-id";
import { GITHUB_RELEASES_URL } from "@/components/onboarding/constants";

export interface NetEndpointValue {
  host: string;
  port: number;
  mode?: UdpMode;
}

/** Build the bridge `--in` spec for the current endpoint. */
function buildInSpec(proto: NetProto, v: NetEndpointValue): string {
  if (proto === "tcp") return `tcp:${v.host}:${v.port}`;
  return v.mode === "target"
    ? `udpout:${v.host}:${v.port}`
    : `udp:${v.host}:${v.port}`;
}

/** Pull the WS port out of a bridge URL (which may carry `?token=`), defaulting to 14551. */
function wsPortOf(url: string): number {
  let n = NaN;
  try {
    n = Number.parseInt(new URL(url.trim()).port, 10);
  } catch {
    // not a URL yet (the operator is still typing)
  }
  return Number.isInteger(n) && n > 0 ? n : 14551;
}

/**
 * The bridge accepts pages served from localhost only unless told otherwise,
 * so a GCS served from anywhere else names its own origin in the command.
 */
function allowOriginArg(): string {
  if (typeof window === "undefined") return "";
  const { origin, hostname } = window.location;
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return loopback ? "" : ` --allow-origin ${origin}`;
}

export function NetEndpointPanel({
  proto,
  value,
  bridgeUrl,
  onChange,
  onBridgeUrlChange,
  onConnected,
  targetDroneId,
}: {
  proto: NetProto;
  value: NetEndpointValue;
  bridgeUrl: string;
  onChange: (next: NetEndpointValue) => void;
  onBridgeUrlChange: (url: string) => void;
  /** Called after a successful connect so the host can close the dialog. */
  onConnected?: (name: string) => void;
  /** When set, attach this transport as an additional link to the drone. */
  targetDroneId?: string | null;
}) {
  const t = useTranslations("connect");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reach, setReach] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const addDrone = useDroneManager((s) => s.addDrone);
  const attachLinkToDrone = useDroneManager((s) => s.attachLinkToDrone);

  const native = isElectron();
  const command = `npx @altnautica/mavlink-bridge --in ${buildInSpec(proto, value)} --ws ${wsPortOf(bridgeUrl)}${allowOriginArg()}`;

  const presets =
    proto === "udp"
      ? [
          { label: "udp:0.0.0.0:14550", v: { host: "0.0.0.0", port: 14550, mode: "listen" as UdpMode } },
          { label: "udp:0.0.0.0:14551", v: { host: "0.0.0.0", port: 14551, mode: "listen" as UdpMode } },
        ]
      : [
          { label: "tcp:127.0.0.1:5760", v: { host: "127.0.0.1", port: 5760 } },
          { label: "tcp:127.0.0.1:5761", v: { host: "127.0.0.1", port: 5761 } },
        ];

  function setHost(host: string) {
    onChange({ ...value, host });
  }
  function setPort(port: string) {
    const n = Number.parseInt(port, 10);
    onChange({ ...value, port: Number.isNaN(n) ? 0 : n });
  }
  function setMode(mode: string) {
    onChange({ ...value, mode: mode as UdpMode });
  }

  function copyCommand() {
    navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  function checkBridge() {
    setReach("checking");
    let settled = false;
    try {
      const ws = new WebSocket(bridgeUrl.trim() || DEFAULT_BRIDGE_URL);
      const done = (state: "ok" | "fail") => {
        if (settled) return;
        settled = true;
        setReach(state);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.onopen = () => done("ok");
      ws.onerror = () => done("fail");
      setTimeout(() => done("fail"), 2500);
    } catch {
      setReach("fail");
    }
  }

  async function handleConnect() {
    setError(null);
    if (!value.host.trim() || !value.port) {
      setError(t("netHostPortRequired"));
      return;
    }
    setConnecting(true);
    let transport: NetMavlinkTransport | null = null;
    let handedOff = false;
    try {
      transport = new NetMavlinkTransport(proto);
      await transport.connect({
        proto,
        host: value.host.trim(),
        port: value.port,
        mode: proto === "udp" ? value.mode ?? "listen" : undefined,
        bridgeUrl: native ? undefined : bridgeUrl.trim() || DEFAULT_BRIDGE_URL,
      });

      if (targetDroneId) {
        const result = await attachLinkToDrone(targetDroneId, transport);
        if (!result.ok) {
          try {
            await transport.disconnect();
          } catch {
            /* ignore */
          }
          setError(result.error);
          setConnecting(false);
          return;
        }
        handedOff = true;
        onConnected?.("link");
        setConnecting(false);
        return;
      }

      const { adapter, vehicleInfo, firmwareType } =
        await connectWithDetection(transport);
      const droneId = resolveNodeId();
      const sysIdSuffix = vehicleInfo.systemId > 0 ? ` #${vehicleInfo.systemId}` : "";
      const droneName = `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})${sysIdSuffix}`;

      addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
        type: proto === "udp" ? "udp-proxy" : "tcp",
        proto,
        host: value.host.trim(),
        port: value.port,
        mode: proto === "udp" ? value.mode ?? "listen" : undefined,
        bridgeUrl: native ? undefined : bridgeUrl.trim() || DEFAULT_BRIDGE_URL,
        firmwareType,
      });

      useDroneMetadataStore.getState().ensureProfile(droneId, {
        displayName: droneName,
        serial: `ALT-${droneId.toUpperCase()}`,
        enrolledAt: Date.now(),
      });

      void saveRecentConnection({
        type: proto === "udp" ? "udp-proxy" : "tcp",
        proto,
        host: value.host.trim(),
        port: value.port,
        mode: proto === "udp" ? value.mode ?? "listen" : undefined,
        bridgeUrl: native ? undefined : bridgeUrl.trim() || DEFAULT_BRIDGE_URL,
        firmwareType,
        name: droneName,
        date: Date.now(),
      });

      handedOff = true;
      onConnected?.(droneName);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("connectionFailed"));
      // The socket opened but the connect failed (e.g. heartbeat timeout); tear
      // it down so a failed attempt doesn't leak the socket + IPC listeners.
      if (transport && !handedOff) {
        try {
          await transport.disconnect();
        } catch {
          /* ignore */
        }
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Endpoint fields */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={t("netHost")}
            value={value.host}
            onChange={(e) => {
              setHost(e.target.value);
              setError(null);
            }}
            placeholder={proto === "udp" ? "0.0.0.0" : "127.0.0.1"}
          />
        </div>
        <div className="w-24">
          <Input
            label={t("netPort")}
            value={String(value.port || "")}
            onChange={(e) => {
              setPort(e.target.value);
              setError(null);
            }}
            placeholder={proto === "udp" ? "14550" : "5760"}
          />
        </div>
        {proto === "udp" && (
          <div className="w-32">
            <Select
              label={t("udpModeLabel")}
              options={[
                { value: "listen", label: t("udpModeListen") },
                { value: "target", label: t("udpModeTarget") },
              ]}
              value={value.mode ?? "listen"}
              onChange={setMode}
            />
          </div>
        )}
      </div>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => onChange(p.v)}
            className="px-2 py-1 text-[10px] font-mono border border-border-default text-text-tertiary hover:text-text-secondary hover:border-border-strong transition-colors cursor-pointer"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Surface banner: native (desktop) vs bridge (browser) */}
      {native ? (
        <div className="flex items-center gap-2 text-[10px] text-status-success">
          <Check size={12} />
          <span>{t("nativeSocketReady")}</span>
        </div>
      ) : (
        <div className="border border-border-default bg-bg-tertiary p-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
            <Terminal size={12} className="shrink-0" />
            <span>{t("bridgeNeeded")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 min-w-0 truncate text-[10px] font-mono text-text-primary bg-bg-primary px-2 py-1 border border-border-default">
              {command}
            </code>
            <Button
              variant="ghost"
              size="sm"
              icon={copied ? <Check size={10} /> : <Copy size={10} />}
              onClick={copyCommand}
            >
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t("bridgeUrlLabel")}
                value={bridgeUrl}
                onChange={(e) => {
                  onBridgeUrlChange(e.target.value);
                  setReach("idle");
                }}
                placeholder="ws://127.0.0.1:14551/?token=…"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={checkBridge}>
              {reach === "checking" ? t("checking") : t("checkBridge")}
            </Button>
          </div>
          {reach === "ok" && (
            <p className="text-[10px] text-status-success">{t("bridgeReachable")}</p>
          )}
          {reach === "fail" && (
            <p className="text-[10px] text-status-warning">{t("bridgeUnreachable")}</p>
          )}
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-accent-primary hover:underline"
          >
            <ExternalLink size={10} />
            {t("getDesktopApp")}
          </a>
        </div>
      )}

      <Button onClick={handleConnect} loading={connecting} icon={<Plug size={14} />}>
        {connecting ? t("connecting") : t("connect")}
      </Button>

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
