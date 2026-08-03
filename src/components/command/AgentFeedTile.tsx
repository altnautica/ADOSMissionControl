"use client";

/**
 * @module AgentFeedTile
 * @description One multi-agent Command overview tile. Renders a per-profile
 * card body so a workstation / ground-station / bare flight controller gets a
 * body that fits its profile instead of the drone card with `--` placeholders.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  Battery,
  Boxes,
  Cpu,
  Expand,
  Gauge,
  HardDrive,
  HeartPulse,
  ListChecks,
  Loader2,
  MapPin,
  Network,
  Pause,
  Pin,
  PinOff,
  Play,
  Power,
  Radio,
  RefreshCw,
  Satellite,
  Server,
  SignalHigh,
  Thermometer,
  TrendingDown,
  Video,
  VideoOff,
  Wifi,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatCommandAge,
  type CommandAgentSummary,
} from "@/hooks/use-command-agent-fleet";
import { useAgentVideoSession } from "@/hooks/use-agent-video-session";
import { useBatteryBand } from "@/lib/battery-bands";
import { StatTile } from "@/components/command/shared/StatTile";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { Badge } from "@/components/ui/badge";
import { NodeGlyph } from "@/components/command/nodes/node-glyph";
import { linkStateReach } from "@/components/hardware/radio/labels";
import { profileTint, type EffProfile } from "@/lib/nodes/node-profile";
import { useDeviceControlAuthority, useControlAuthorityNotice } from "@/hooks/use-node-control-authority";

interface AgentFeedTileProps {
  agent: CommandAgentSummary;
  pinned: boolean;
  paused: boolean;
  onOpen: (deviceId: string) => void;
  onTogglePin: (deviceId: string) => void;
  onTogglePause: (deviceId: string) => void;
}

// A tile that has been "connecting" longer than this is wedged. Force a
// fresh session attempt rather than spinning the placeholder forever.
const TILE_CONNECT_TIMEOUT_MS = 15_000;

function pct(value: number | null): string {
  return value == null ? "--" : `${Math.round(value)}%`;
}

function fixed(value: number | null, digits = 0, suffix = ""): string {
  return value == null ? "--" : `${value.toFixed(digits)}${suffix}`;
}

/**
 * Pick the presentation profile for a fleet tile from the summary, mirroring
 * the node-detail `effectiveNodeProfile` view-model (which keys on a
 * `SurfaceContext` this fleet tile does not have). A `drone`-profile node with
 * a live flight controller but no companion computer (no CPU/Mem/Temp and no
 * camera pipeline) is a bare flight controller, surfaced as its own kind.
 */
function tileEffProfile(agent: CommandAgentSummary): EffProfile {
  if (agent.profile === "ground-station") return "ground-station";
  if (agent.profile === "workstation") return "workstation";
  const noCompanion =
    agent.system.cpuPercent == null &&
    agent.system.memoryPercent == null &&
    agent.system.temperature == null;
  const noVideo = !agent.video.whepUrl && !agent.video.active;
  if (agent.system.fcReachable && noCompanion && noVideo) {
    return "flight-controller";
  }
  return "drone";
}

function livenessLevel(liveness: CommandAgentSummary["liveness"]): StatusLevel {
  return liveness === "live" ? "good" : liveness === "stale" ? "serious" : "offline";
}

export function AgentFeedTile(props: AgentFeedTileProps) {
  return <ConsoleAgentFeedTile {...props} />;
}

// The 4-button action cluster (pin, pause, retry, open) or a compact
// pin+open cluster for the profiles that have no video feed.
function TileActions({
  agent,
  pinned,
  paused,
  showVideoControls,
  onOpen,
  onTogglePin,
  onTogglePause,
  onRetry,
}: {
  agent: CommandAgentSummary;
  pinned: boolean;
  paused: boolean;
  showVideoControls: boolean;
  onOpen: (deviceId: string) => void;
  onTogglePin: (deviceId: string) => void;
  onTogglePause: (deviceId: string) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("commandFleet");
  return (
    <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(agent.identity.deviceId);
        }}
        className="rounded bg-black/55 p-1 text-text-secondary hover:text-text-primary"
        title={pinned ? t("unpin") : t("pin")}
      >
        {pinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
      {showVideoControls && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePause(agent.identity.deviceId);
            }}
            className="rounded bg-black/55 p-1 text-text-secondary hover:text-text-primary"
            title={paused ? t("resume") : t("pause")}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="rounded bg-black/55 p-1 text-text-secondary hover:text-text-primary"
            title={t("retry")}
          >
            <RefreshCw size={13} />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(agent.identity.deviceId);
        }}
        className="rounded bg-accent-primary p-1 text-bg-primary hover:opacity-90"
        title={t("open")}
      >
        <Expand size={13} />
      </button>
    </div>
  );
}

// The profile-correct badge cluster, shared by the video overlay and the
// no-video header. Colour is never the only channel — the liveness dot carries
// an accessible label.
function TileBadges({
  effProfile,
  agent,
}: {
  effProfile: EffProfile;
  agent: CommandAgentSummary;
}) {
  const t = useTranslations("commandFleet");
  const tNode = useTranslations("nodeConsole");
  // Separate from the liveness badge on purpose: a tile can be live and
  // uncommandable at once, and one badge cannot carry both.
  const authority = useControlAuthorityNotice(
    useDeviceControlAuthority(agent.identity.deviceId),
  );
  const live = agent.liveness;
  const liveLevel = livenessLevel(live);
  const liveVariant = live === "live" ? "success" : live === "stale" ? "warning" : "neutral";
  const radio = agent.radio;
  const reach = radio ? linkStateReach(radio.state) : "down";
  const roleLabel =
    agent.role === "direct"
      ? t("roleDirect")
      : agent.role === "relay"
        ? t("roleRelay")
        : agent.role === "receiver"
          ? t("roleReceiver")
          : null;
  const pairedShort = radio?.pairedWithDeviceId
    ? radio.pairedWithDeviceId.slice(0, 8)
    : null;
  const typeBadge =
    effProfile === "ground-station"
      ? t("profileGround")
      : effProfile === "drone"
        ? t("profileDrone")
        : effProfile === "workstation"
          ? tNode("type.workstation")
          : tNode("type.flightController");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={liveVariant} className="gap-1">
        <StatusDot status={liveLevel} size="xs" pulse={live === "live"} label={t(live)} />
        {t(live)}
      </Badge>
      <Badge variant="info">{typeBadge}</Badge>
      {authority.show && (
        <Badge
          variant={authority.level === "warning" ? "warning" : "neutral"}
          className="gap-1"
        >
          {/* The dot carries the full sentence as its aria-label and title. */}
          <StatusDot
            status={authority.level}
            size="xs"
            label={authority.detail}
          />
          {authority.label}
        </Badge>
      )}
      {effProfile === "drone" && (
        <>
          <Badge variant={agent.system.fcReachable ? "success" : "neutral"}>
            {agent.system.fcReachable ? t("fcOn") : t("fcOff")}
          </Badge>
          {agent.telemetry.armed != null && (
            <Badge variant={agent.telemetry.armed ? "error" : "neutral"}>
              {agent.telemetry.armed ? t("armed") : t("disarmed")}
            </Badge>
          )}
        </>
      )}
      {effProfile === "flight-controller" && agent.telemetry.armed != null && (
        <Badge variant={agent.telemetry.armed ? "error" : "neutral"}>
          {agent.telemetry.armed ? t("armed") : t("disarmed")}
        </Badge>
      )}
      {effProfile === "ground-station" && (
        <>
          {roleLabel && <Badge variant="neutral">{roleLabel}</Badge>}
          <Badge
            variant={
              reach === "unproven"
                ? "warning"
                : reach === "up"
                  ? "success"
                  : "neutral"
            }
          >
            {reach === "unproven"
              ? t("linkUnverified")
              : reach === "up"
                ? t("linked")
                : t("noLink")}
          </Badge>
          {pairedShort && (
            <Badge variant="neutral" className="font-mono normal-case tracking-normal">
              {t("paired")} {pairedShort}
            </Badge>
          )}
        </>
      )}
      {/* workstation: cluster role + GPU backend are not on the fleet summary
          yet, so only the honest liveness + type badges are shown here. */}
    </div>
  );
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
  const [retryKey, setRetryKey] = useState(0);

  const effProfile = tileEffProfile(agent);
  const hasVideoArea = effProfile === "drone" || effProfile === "ground-station";
  // Battery severity from the operator's configured thresholds — the shared
  // resolver, so this grid, the fleet board and the alert pipeline agree.
  const batteryLevel = useBatteryBand(agent.telemetry.batteryRemaining);

  // The video session is always subscribed (hook order is stable); it stays
  // idle for the no-video profiles because `enabled` is false.
  const videoEnabled = hasVideoArea && agent.video.active && !!agent.video.whepUrl;
  const session = useAgentVideoSession({
    whepUrl: agent.video.whepUrl,
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

  useEffect(() => {
    if (!connecting) return;
    const handle = setTimeout(() => {
      setRetryKey((k) => k + 1);
    }, TILE_CONNECT_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [connecting]);

  const retry = useCallback(() => setRetryKey((k) => k + 1), []);
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
              "absolute inset-0 h-full w-full object-cover bg-black",
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
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-black/60 px-2 py-1 text-[10px] font-mono text-text-secondary">
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

          {effProfile === "workstation" && (
            // Compute activity strip. Cluster role / workers / jobs / GPU
            // utilisation ride the LAN poll only and are not on the fleet
            // summary yet, so they render as honest grey until the agent
            // telemetry track lands them on the heartbeat.
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile icon={<Zap size={12} />} label="GPU" value="--" level="idle" />
              <StatTile icon={<Server size={12} />} label="Role" value="--" level="idle" />
              <StatTile icon={<Boxes size={12} />} label="Workers" value="--" level="idle" />
              <StatTile icon={<ListChecks size={12} />} label="Jobs" value="--" level="idle" />
            </div>
          )}
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

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {effProfile === "drone" && (
            <>
              <StatTile icon={<Battery size={12} />} label={t("battery")} value={pct(agent.telemetry.batteryRemaining)} level={batteryLevel} />
              <StatTile icon={<Satellite size={12} />} label={t("gps")} value={agent.telemetry.gpsSatellites == null ? "--" : `${agent.telemetry.gpsSatellites}`} />
              <StatTile icon={<MapPin size={12} />} label={t("alt")} value={fixed(agent.telemetry.altitudeRel, 0, "m")} />
              <StatTile icon={<Gauge size={12} />} label={t("mode")} value={agent.telemetry.mode ?? "--"} />
              <StatTile icon={<Cpu size={12} />} label={t("cpu")} value={pct(agent.system.cpuPercent)} />
              <StatTile icon={<Radio size={12} />} label={t("mem")} value={pct(agent.system.memoryPercent)} />
              <StatTile icon={<Thermometer size={12} />} label={t("temp")} value={fixed(agent.system.temperature, 0, "C")} />
              <StatTile icon={<Video size={12} />} label={t("video")} value={t(agent.video.state)} />
            </>
          )}

          {effProfile === "flight-controller" && (
            <>
              <StatTile
                icon={<Power size={12} />}
                label="Arm" /* i18n: nodeConsole FC arm-state tile */
                value={agent.telemetry.armed == null ? "--" : agent.telemetry.armed ? t("armed") : t("disarmed")}
                level={agent.telemetry.armed == null ? undefined : agent.telemetry.armed ? "warning" : "good"}
              />
              <StatTile icon={<Gauge size={12} />} label={t("mode")} value={agent.telemetry.mode ?? "--"} />
              <StatTile icon={<Satellite size={12} />} label={t("gps")} value={agent.telemetry.gpsSatellites == null ? "--" : `${agent.telemetry.gpsSatellites}`} />
              <StatTile icon={<Battery size={12} />} label={t("battery")} value={pct(agent.telemetry.batteryRemaining)} level={batteryLevel} />
              <StatTile
                icon={<HeartPulse size={12} />}
                label="Heartbeat" /* i18n: nodeConsole FC heartbeat-Hz tile (honest grey until on the heartbeat) */
                value="--"
                level="idle"
              />
            </>
          )}

          {effProfile === "ground-station" && (
            <>
              <StatTile icon={<SignalHigh size={12} />} label={t("rssi")} value={radio?.rssiDbm == null ? "--" : `${Math.round(radio.rssiDbm)} dBm`} />
              <StatTile icon={<Activity size={12} />} label={t("snr")} value={radio?.snrDb == null ? "--" : `${Math.round(radio.snrDb)} dB`} />
              <StatTile icon={<TrendingDown size={12} />} label={t("loss")} value={radio?.lossPercent == null ? "--" : `${radio.lossPercent.toFixed(1)}%`} />
              <StatTile icon={<Wifi size={12} />} label={t("link")} value={radio?.bitrateKbps == null ? "--" : `${(radio.bitrateKbps / 1000).toFixed(1)} Mbps`} />
              <StatTile
                icon={<Network size={12} />}
                label="Uplink" /* i18n: nodeConsole GS uplink tile (honest grey until on the fleet summary) */
                value="--"
                level="idle"
              />
              <StatTile
                icon={<Network size={12} />}
                label="Mesh" /* i18n: nodeConsole GS mesh tile (honest grey until on the fleet summary) */
                value="--"
                level="idle"
              />
              <StatTile icon={<Cpu size={12} />} label={t("cpu")} value={pct(agent.system.cpuPercent)} />
              <StatTile icon={<Thermometer size={12} />} label={t("temp")} value={fixed(agent.system.temperature, 0, "C")} />
            </>
          )}

          {effProfile === "workstation" && (
            <>
              <StatTile icon={<Cpu size={12} />} label={t("cpu")} value={pct(agent.system.cpuPercent)} />
              <StatTile icon={<Radio size={12} />} label={t("mem")} value={pct(agent.system.memoryPercent)} />
              <StatTile icon={<HardDrive size={12} />} label="Disk" /* i18n: nodeConsole workstation disk tile */ value={pct(agent.system.diskPercent)} />
              <StatTile icon={<Thermometer size={12} />} label={t("temp")} value={fixed(agent.system.temperature, 0, "C")} />
            </>
          )}
        </div>
      </button>
    </article>
  );
}

