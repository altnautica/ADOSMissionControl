"use client";

/**
 * @module AgentFeedTile
 * @description One multi-agent Command overview tile. Renders a per-profile
 * card body so a workstation / ground-station / bare flight controller gets a
 * body that fits its profile instead of the drone card with `--` placeholders.
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  Battery,
  Cpu,
  Gauge,
  HardDrive,
  HeartPulse,
  Loader2,
  MapPin,
  Pause,
  Power,
  Radio,
  Satellite,
  SignalHigh,
  Thermometer,
  TrendingDown,
  Video,
  VideoOff,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatOr } from "@/lib/format";
import {
  formatCommandAge,
  type CommandAgentSummary,
} from "@/hooks/use-command-agent-fleet";
import { useAgentVideoSession } from "@/hooks/use-agent-video-session";
import { usePairedWhepKey } from "@/hooks/use-whep-key";
import { useBatteryBand } from "@/lib/battery-bands";
import { StatTile } from "@/components/command/shared/StatTile";
import { NodeGlyph } from "@/components/command/nodes/node-glyph";
import { profileTint } from "@/lib/nodes/node-profile";
import { pct, tileEffProfile } from "./agent-feed-tile-format";
import { TileActions } from "./AgentFeedTileActions";
import { TileBadges } from "./AgentFeedTileBadges";
import { useConnectWatchdog, useFeedVideoRetry } from "./use-feed-video-retry";

interface AgentFeedTileProps {
  agent: CommandAgentSummary;
  pinned: boolean;
  paused: boolean;
  onOpen: (deviceId: string) => void;
  onTogglePin: (deviceId: string) => void;
  onTogglePause: (deviceId: string) => void;
}


export function AgentFeedTile(props: AgentFeedTileProps) {
  return <ConsoleAgentFeedTile {...props} />;
}

function ConsoleAgentFeedTile({
  agent,
  pinned,
  paused,
  onOpen,
  onTogglePin,
  onTogglePause,
}: AgentFeedTileProps) {
  const t = useTranslations("commandFleet");
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const { retryKey, retry } = useFeedVideoRetry();

  const effProfile = tileEffProfile(agent);
  const hasVideoArea = effProfile === "drone" || effProfile === "ground-station";
  // Battery severity from the operator's configured thresholds — the shared
  // resolver, so this grid, the fleet board and the alert pipeline agree.
  const batteryLevel = useBatteryBand(agent.telemetry.batteryRemaining);

  // The video session is always subscribed (hook order is stable); it stays
  // idle for the no-video profiles because `enabled` is false.
  // Only a feed the fleet view resolved as live holds a session: a queued,
  // stale or offline tile must not keep dialing and pin a feed slot.
  const videoEnabled = hasVideoArea && agent.video.state === "live" && !!agent.video.whepUrl;
  const whepApiKey = usePairedWhepKey(
    agent.identity.deviceId,
    agent.video.whepUrl,
    agent.identity.lastIp,
  );
  const session = useAgentVideoSession({
    whepUrl: agent.video.whepUrl,
    apiKey: whepApiKey,
    enabled: videoEnabled,
    videoEl,
    retryKey,
  });

  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    setVideoEl(el);
  }, []);

  const hasVideo = session.state === "connected";
  const connecting = session.state === "connecting";
  const failed = session.state === "failed";

  useConnectWatchdog(connecting, retry);
  const radio = agent.radio;

  return (
    <article
      className={cn(
        "group overflow-hidden rounded-lg border bg-bg-secondary transition-colors",
        agent.liveness === "live"
          ? "border-border-default hover:border-accent-primary/50"
          : "border-border-default opacity-80",
      )}
      style={profileTint(effProfile, { bg: 4, border: 24 })}
    >
      {hasVideoArea ? (
        <div className="relative aspect-video bg-bg-primary">
          <video
            ref={setVideoRef}
            autoPlay
            muted
            playsInline
            className={cn(
              "absolute inset-0 h-full w-full object-cover bg-media",
              !hasVideo && "hidden",
            )}
          />

          {!hasVideo && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-tertiary">
              {connecting ? (
                <>
                  <Loader2 size={24} className="text-accent-primary animate-spin" />
                  <span className="text-[10px] font-mono tracking-widest">
                    {t("connecting")}
                  </span>
                </>
              ) : failed ? (
                <>
                  <VideoOff size={26} className="text-status-error" />
                  <span className="max-w-[80%] truncate text-[10px] font-mono text-status-error">
                    {session.error ?? t("videoFailed")}
                  </span>
                </>
              ) : agent.video.queued ? (
                <>
                  <Video size={26} className="text-accent-primary" />
                  <span className="text-[10px] font-mono tracking-widest">
                    {t("queued")}
                  </span>
                </>
              ) : paused ? (
                <>
                  <Pause size={26} />
                  <span className="text-[10px] font-mono tracking-widest">
                    {t("paused")}
                  </span>
                </>
              ) : (
                <>
                  <VideoOff size={26} />
                  <span className="text-[10px] font-mono tracking-widest">
                    {agent.liveness === "offline" ? t("offline") : t("noVideo")}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="absolute left-2 top-2">
            <TileBadges effProfile={effProfile} agent={agent} />
          </div>

          <div className="absolute right-2 top-2">
            <TileActions
              agent={agent}
              pinned={pinned}
              paused={paused}
              showVideoControls
              onOpen={onOpen}
              onTogglePin={onTogglePin}
              onTogglePause={onTogglePause}
              onRetry={retry}
            />
          </div>

          {hasVideo && (
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-scrim/60 px-2 py-1 text-[10px] font-mono text-text-secondary">
              <span>{session.stats.fps > 0 ? `${session.stats.fps} FPS` : "-- FPS"}</span>
              <span>{session.stats.bitrateKbps > 0 ? `${session.stats.bitrateKbps} kbps` : "-- kbps"}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="border-b border-border-default p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <NodeGlyph profile={effProfile} size={18} />
              <TileBadges effProfile={effProfile} agent={agent} />
            </div>
            <TileActions
              agent={agent}
              pinned={pinned}
              paused={paused}
              showVideoControls={false}
              onOpen={onOpen}
              onTogglePin={onTogglePin}
              onTogglePause={onTogglePause}
              onRetry={retry}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpen(agent.identity.deviceId)}
        className="block w-full p-3 text-left"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-text-primary">
              {agent.identity.name}
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-text-tertiary">
              {agent.identity.board ?? t("unknownBoard")}
              {agent.identity.tier ? ` · T${agent.identity.tier}` : ""}
              {agent.identity.version ? ` · v${agent.identity.version}` : ""}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-text-tertiary">
            {formatCommandAge(agent.lastSeen)}
          </span>
        </div>

        {/* Columns follow the tile's own width, not the viewport: a narrow
            tile in a wide grid keeps two readable columns. */}
        <div className="@container mt-3">
        <div className="grid grid-cols-2 gap-2 @[420px]:grid-cols-4" data-testid="agent-feed-stats">
          {effProfile === "drone" && (
            <>
              <StatTile icon={<Battery size={12} />} label={t("battery")} value={pct(agent.telemetry.batteryRemaining)} level={batteryLevel} />
              <StatTile icon={<Satellite size={12} />} label={t("gps")} value={agent.telemetry.gpsSatellites == null ? "--" : `${agent.telemetry.gpsSatellites}`} />
              <StatTile icon={<MapPin size={12} />} label={t("alt")} value={formatOr(agent.telemetry.altitudeRel, 0, "m")} />
              <StatTile icon={<Gauge size={12} />} label={t("mode")} value={agent.telemetry.mode ?? "--"} />
              <StatTile icon={<Cpu size={12} />} label={t("cpu")} value={pct(agent.system.cpuPercent)} />
              <StatTile icon={<Radio size={12} />} label={t("mem")} value={pct(agent.system.memoryPercent)} />
              <StatTile icon={<Thermometer size={12} />} label={t("temp")} value={formatOr(agent.system.temperature, 0, "C")} />
              <StatTile icon={<Video size={12} />} label={t("video")} value={t(agent.video.state)} wrapValue />
            </>
          )}

          {effProfile === "flight-controller" && (
            <>
              <StatTile
                icon={<Power size={12} />}
                label={t("arm")}
                value={agent.telemetry.armed == null ? "--" : agent.telemetry.armed ? t("armed") : t("disarmed")}
                level={agent.telemetry.armed == null ? undefined : agent.telemetry.armed ? "warning" : "good"}
              />
              <StatTile icon={<Gauge size={12} />} label={t("mode")} value={agent.telemetry.mode ?? "--"} />
              <StatTile icon={<Satellite size={12} />} label={t("gps")} value={agent.telemetry.gpsSatellites == null ? "--" : `${agent.telemetry.gpsSatellites}`} />
              <StatTile icon={<Battery size={12} />} label={t("battery")} value={pct(agent.telemetry.batteryRemaining)} level={batteryLevel} />
              <StatTile
                icon={<HeartPulse size={12} />}
                label={t("heartbeat")}
                value={formatCommandAge(agent.lastSeen)}
              />
            </>
          )}

          {effProfile === "ground-station" && (
            <>
              <StatTile icon={<SignalHigh size={12} />} label={t("rssi")} value={radio?.rssiDbm == null ? "--" : `${Math.round(radio.rssiDbm)} dBm`} />
              <StatTile icon={<Activity size={12} />} label={t("snr")} value={radio?.snrDb == null ? "--" : `${Math.round(radio.snrDb)} dB`} />
              <StatTile icon={<TrendingDown size={12} />} label={t("loss")} value={radio?.lossPercent == null ? "--" : `${radio.lossPercent.toFixed(1)}%`} />
              <StatTile icon={<Wifi size={12} />} label={t("link")} value={radio?.bitrateKbps == null ? "--" : `${(radio.bitrateKbps / 1000).toFixed(1)} Mbps`} />
              {/* Uplink and mesh have no source on this tile yet, so they are
                  not drawn rather than shown as a permanent "--". */}
              <StatTile icon={<Cpu size={12} />} label={t("cpu")} value={pct(agent.system.cpuPercent)} />
              <StatTile icon={<Thermometer size={12} />} label={t("temp")} value={formatOr(agent.system.temperature, 0, "C")} />
            </>
          )}

          {(effProfile === "workstation" || effProfile === "visor" || effProfile === "unknown") && (
            <>
              <StatTile icon={<Cpu size={12} />} label={t("cpu")} value={pct(agent.system.cpuPercent)} />
              <StatTile icon={<Radio size={12} />} label={t("mem")} value={pct(agent.system.memoryPercent)} />
              <StatTile icon={<HardDrive size={12} />} label={t("disk")} value={pct(agent.system.diskPercent)} />
              <StatTile icon={<Thermometer size={12} />} label={t("temp")} value={formatOr(agent.system.temperature, 0, "C")} />
            </>
          )}
        </div>
        </div>
      </button>
    </article>
  );
}
