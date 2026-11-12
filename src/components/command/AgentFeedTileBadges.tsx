"use client";

import { useTranslations } from "next-intl";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import { StatusDot } from "@/components/ui/status-dot";
import { Badge } from "@/components/ui/badge";
import { profileTypeKey } from "@/components/command/nodes/NodeRow";
import { linkStateReach } from "@/components/hardware/radio/labels";
import type { EffProfile } from "@/lib/nodes/node-profile";
import { useDeviceControlAuthority, useControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import { livenessLevel } from "./agent-feed-tile-format";

// The profile-correct badge cluster, shared by the video overlay and the
// no-video header. Colour is never the only channel — the liveness dot carries
// an accessible label.
export function TileBadges({
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
        : tNode(`type.${profileTypeKey(effProfile)}`);

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
            <Badge variant="neutral" className="font-mono">
              {t("paired")} {pairedShort}
            </Badge>
          )}
        </>
      )}
    </div>
  );
}
