"use client";

import { Cpu, Radio, Navigation } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTelemetryFreshness } from "@/hooks/use-telemetry-freshness";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { usePrearmBufferStore } from "@/stores/prearm-buffer-store";
import { useHeartbeatRate } from "@/hooks/use-heartbeat-rate";
import { useMqttControlAuthority } from "@/hooks/use-mqtt-control-authority";
import { canPublishFcFrames } from "@/lib/nodes/mqtt-control-authority";
import type { Transport } from "@/lib/protocol/types/transport";

interface FlightDataCardProps {
  className?: string;
}

/** Transport type -> its `nodeConsole.transport.*` key. Protocol names stay
 * untranslated in every locale; only the relay lane carries prose. */
const TRANSPORT_KEY: Record<Transport["type"], string> = {
  webserial: "webserial",
  websocket: "websocket",
  tcp: "tcp",
  "udp-proxy": "udpProxy",
  "mqtt-mavlink": "mqttMavlink",
  ble: "ble",
};

/** Stable empty reference — a fresh `[]` from the selector breaks the
 * useSyncExternalStore snapshot cache and loops. */
const EMPTY_LINES: string[] = [];

/** One compact FC-link stat (label + value + optional status dot). */
function LinkStat({
  label,
  value,
  level,
}: {
  label: string;
  value: string;
  level?: StatusLevel;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1 text-text-tertiary">
        {label}
        {level && <StatusDot status={level} size="xs" />}
      </span>
      <span className="truncate font-mono text-text-primary">{value}</span>
    </div>
  );
}

/**
 * MAVLink GPS_FIX_TYPE -> its `indicators.gpsFix.*` key plus severity colour.
 * Fix types above 6 (STATIC, PPP) have no entry and fall back to 0, which is
 * the pre-existing behaviour of this card.
 */
const FIX_LABELS: Record<number, { key: string; color: string }> = {
  0: { key: "noGps", color: "text-status-error" },
  1: { key: "noFix", color: "text-status-error" },
  2: { key: "fix2d", color: "text-status-warning" },
  3: { key: "fix3d", color: "text-status-success" },
  4: { key: "dgps", color: "text-status-success" },
  5: { key: "rtkFloat", color: "text-accent-primary" },
  6: { key: "rtk", color: "text-accent-primary" },
};

function normalizeHeading(deg: number) {
  return ((deg % 360) + 360) % 360;
}

export function FlightDataCard({ className }: FlightDataCardProps) {
  const t = useTranslations("nodeConsole");
  const tFix = useTranslations("indicators.gpsFix");
  useTelemetryStore((s) => s._version);
  const attitude = useTelemetryStore((s) => s.attitude);
  const position = useTelemetryStore((s) => s.position);
  const gps = useTelemetryStore((s) => s.gps);
  const radio = useTelemetryStore((s) => s.radio);
  const freshness = useTelemetryFreshness();

  const att = attitude.latest();
  const pos = position.latest();
  const gpsData = gps.latest();
  const radioData = radio.latest();

  // The ring buffers keep their last sample when the link dies, so a stale
  // value would otherwise render as live (0deg roll, etc.). Gate the
  // attitude/heading readouts on channel freshness: once a channel goes
  // "lost"/"none" (no sample within the freshness window) blank it to the
  // placeholder rather than show the frozen last value.
  const isChannelLive = (level: string) =>
    level === "fresh" || level === "stale";
  const attLive = isChannelLive(freshness.getFreshness("attitude"));
  const posLive = isChannelLive(freshness.getFreshness("position"));
  const headingLive = attLive || posLive;
  // We have buffered attitude data but it has gone stale — the link is silent.
  const attStale = att !== undefined && !attLive;

  const fix = FIX_LABELS[gpsData?.fixType ?? 0] ?? FIX_LABELS[0];
  // Gate GPS-derived fields on a real fix. Without a fix
  // the FC reports HDOP ~655, lat/lon 0.0, MSL 0.0, heading 360 — all
  // garbage that pollutes the bench dashboard.
  const hasFix = (gpsData?.fixType ?? 0) >= 2;
  // Gate the GPS readouts on BOTH a real fix AND channel freshness: a silent
  // link keeps the last buffered fix, which would otherwise render frozen
  // lat/lon/MSL/sats as if live (the same stale-as-live class blanked above for
  // attitude). gps-derived fields use gps freshness; pos-derived use position.
  const gpsLive = isChannelLive(freshness.getFreshness("gps"));
  const gpsShow = hasFix && gpsLive;
  const posShow = hasFix && posLive;
  // Attitude/heading in the telemetry store are ALREADY in degrees (the
  // ingest handler converts MAVLink radians once). Format them directly —
  // re-applying a rad->deg conversion here yielded the ~57x garbage.
  const heading = pos?.heading ?? (att ? normalizeHeading(att.yaw) : undefined);

  const fmtDeg = (v: number | undefined) =>
    v !== undefined ? v.toFixed(1) : "--.-";
  const fmtHdg = (v: number | undefined) =>
    v !== undefined ? v.toFixed(0).padStart(3, "0") : "---";

  // FC-link summary — mode / arm state / heartbeat rate / transport, from the
  // direct MAVLink stream. Merged from the former standalone FC card so Flight
  // Data is the single consolidated FC console.
  const connectionState = useDroneStore((s) => s.connectionState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const prearmBuffers = usePrearmBufferStore((s) => s.buffers);
  const prearmLines = selectedId
    ? (prearmBuffers[selectedId] ?? EMPTY_LINES)
    : EMPTY_LINES;
  const transportType = useDroneManager((s) => {
    const id = s.selectedDroneId;
    return id ? (s.drones.get(id)?.transport.type ?? null) : null;
  });
  // A submarine measures depth, not altitude — relabel the relative-altitude
  // readout to "Depth" and show it as a positive value (Rule 44: honest per
  // vehicle). A rover/boat stays at ~0 relative altitude via its ground path.
  const vehicleClass = useDroneManager((s) => {
    const id = s.selectedDroneId;
    const proto = id ? s.drones.get(id)?.protocol : null;
    return proto?.getVehicleInfo()?.vehicleClass ?? null;
  });
  const isSub = vehicleClass === "sub";
  const { hz, stale: hbStale } = useHeartbeatRate();
  const fcConnected = connectionState !== "disconnected";
  const armed = armState === "armed";
  const prearmBlocked = !armed && prearmLines.length > 0;
  const armLevel: StatusLevel = !fcConnected
    ? "offline"
    : armed
      ? "good"
      : prearmBlocked
        ? "warning"
        : "idle";
  const armLabel = !fcConnected
    ? "—"
    : armed
      ? t("arm.armed")
      : prearmBlocked
        ? t("arm.prearmBlocked")
        : t("arm.disarmed");
  const hbLevel: StatusLevel = !fcConnected
    ? "offline"
    : hbStale
      ? "serious"
      : hz != null
        ? "good"
        : "idle";
  const hbValue = fcConnected && hz != null ? `${hz.toFixed(1)} Hz` : "—";
  // The transport being open is not the same as the transport being able to
  // carry a command. On the cloud relay the browser's broker credential is
  // read-only, so FC frames are published into a broker that discards them:
  // telemetry keeps arriving on the receive lane and the link reads healthy
  // while nothing sent from here reaches the aircraft. Grading this dot on
  // `fcConnected` alone is what made that state invisible.
  const authority = useMqttControlAuthority();
  const canCommand = canPublishFcFrames(authority);
  const linkValue = transportType
    ? t(`transport.${TRANSPORT_KEY[transportType]}`)
    : "—";
  const linkLevel: StatusLevel = !fcConnected
    ? "offline"
    : canCommand
      ? "good"
      : "warning";
  // Deliberately narrow: agent commands (service restart, configuration,
  // update) ride the cloud database rather than the broker and are unaffected,
  // so this must not read as a total loss of control.
  const authorityNote =
    fcConnected && !canCommand
      ? authority.reason === "provisioning"
        ? t("authority.provisioning")
        : t("authority.receiveOnly")
      : null;

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg bg-bg-secondary p-3",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Cpu className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">
          Flight Data
        </span>
        {attStale && (
          <span className="ml-auto text-[10px] font-medium text-status-warning">
            link silent
          </span>
        )}
        <StatusDot
          status={fcConnected ? "good" : "offline"}
          size="xs"
          className={attStale ? "" : "ml-auto"}
        />
      </div>

      {/* FC link — mode / arm state / heartbeat / transport */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        <LinkStat label="Mode" value={fcConnected ? flightMode : "—"} />
        <LinkStat label="State" value={armLabel} level={armLevel} />
        <LinkStat label="Heartbeat" value={hbValue} level={hbLevel} />
        <LinkStat label="Link" value={linkValue} level={linkLevel} />
      </div>
      {authorityNote && (
        <p className="mt-1 text-[10px] leading-snug text-status-warning">
          {authorityNote}
        </p>
      )}
      {prearmBlocked && (
        <p className="mt-1 truncate text-[10px] text-status-warning">
          {prearmLines[prearmLines.length - 1]}
        </p>
      )}

      {/* Attitude section */}
      <div className="border-t border-border-default mt-2 pt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        <div className="flex justify-between">
          <span className="text-text-tertiary">Roll</span>
          <span className="font-mono text-text-primary">
            {fmtDeg(attLive ? att?.roll : undefined)}&deg;
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-tertiary">Pitch</span>
          <span className="font-mono text-text-primary">
            {fmtDeg(attLive ? att?.pitch : undefined)}&deg;
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-tertiary">Yaw</span>
          <span className="font-mono text-text-primary">
            {fmtDeg(attLive ? att?.yaw : undefined)}&deg;
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-tertiary">Hdg</span>
          <span className="font-mono text-text-primary">
            {fmtHdg(headingLive ? heading : undefined)}&deg;
          </span>
        </div>
      </div>

      {/* GPS section */}
      <div className="border-t border-border-default mt-2 pt-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1">
            <Navigation className="w-3 h-3 text-text-tertiary" />
            <span className="text-[10px] font-medium text-text-secondary">
              GPS
            </span>
          </div>
          <span
            className={cn(
              "text-[10px] font-mono font-medium",
              gpsLive ? fix.color : "text-text-tertiary"
            )}
          >
            {gpsLive ? tFix(fix.key) : "--"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-text-tertiary">Sats</span>
            <span className="font-mono text-text-primary">
              {gpsLive ? (gpsData?.satellites ?? "--") : "--"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">HDOP</span>
            <span className="font-mono text-text-primary">
              {gpsShow ? gpsData!.hdop.toFixed(1) : "--.-"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Lat</span>
            <span className="font-mono text-text-primary">
              {gpsShow ? gpsData!.lat.toFixed(6) : "---.------"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Lon</span>
            <span className="font-mono text-text-primary">
              {gpsShow ? gpsData!.lon.toFixed(6) : "---.------"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">MSL</span>
            <span className="font-mono text-text-primary">
              {gpsShow ? `${gpsData!.alt.toFixed(1)}m` : "--.-m"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">{isSub ? "Depth" : "Rel"}</span>
            <span className="font-mono text-text-primary">
              {posShow && pos
                ? `${(isSub ? Math.abs(pos.relativeAlt) : pos.relativeAlt).toFixed(1)}m`
                : "--.-m"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Hdg</span>
            <span className="font-mono text-text-primary">
              {posShow && pos ? `${pos.heading.toFixed(0)}\u00B0` : "--\u00B0"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">GS</span>
            <span className="font-mono text-text-primary">
              {posShow && pos ? `${pos.groundSpeed.toFixed(1)} m/s` : "-- m/s"}
            </span>
          </div>
        </div>
      </div>

      {/* Radio section */}
      <div className="border-t border-border-default mt-2 pt-2">
        <div className="flex items-center gap-1 mb-1">
          <Radio className="w-3 h-3 text-text-tertiary" />
          <span className="text-[10px] font-medium text-text-secondary">
            Radio
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-text-tertiary">RSSI</span>
            <span className="font-mono text-text-primary">
              {radioData ? `${radioData.rssi} dBm` : "-- dBm"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Remote</span>
            <span className="font-mono text-text-primary">
              {radioData ? `${radioData.remrssi} dBm` : "-- dBm"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">TX</span>
            <span className="font-mono text-text-primary">
              {radioData ? `${radioData.txbuf}%` : "--%"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">RX Err</span>
            <span className="font-mono text-text-primary">
              {radioData ? `${radioData.rxerrors}` : "--"}
            </span>
          </div>
        </div>
      </div>

      {/* No data fallback */}
      {!att && !gpsData && !radioData && (
        <div className="text-[10px] text-text-tertiary text-center mt-2">
          Waiting for telemetry...
        </div>
      )}
    </div>
  );
}
