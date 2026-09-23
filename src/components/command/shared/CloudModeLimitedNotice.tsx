"use client";

/**
 * @module CloudModeLimitedNotice
 * @description Notice ribbon shown on ground-station tabs that require
 * direct LAN HTTP access to the agent. When the GCS is talking to the
 * agent via cloud relay (https origin), write controls for network,
 * display, OLED, mesh, and distributed RX are not reachable — the
 * heartbeat carries read-only summaries but mutations route through
 * the LAN-only REST surface. This notice surfaces that constraint and
 * points the operator at the node's own settings page on the same LAN.
 * @license GPL-3.0-only
 */

import { Cloud, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

export type CloudLimitedFeature =
  | "network"
  | "display"
  | "physicalUi"
  | "peripherals"
  | "mesh"
  | "distributedRx";

interface CloudModeLimitedNoticeProps {
  feature: CloudLimitedFeature;
}

export function CloudModeLimitedNotice({ feature }: CloudModeLimitedNoticeProps) {
  const t = useTranslations("command.cloudMode.limited");
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const localNode = useLocalNodesStore((s) =>
    cloudDeviceId
      ? s.nodes.find((n) => n.deviceId === cloudDeviceId) ?? null
      : null,
  );
  // The stored hostname is the base URL the pairing proved (scheme, host and
  // port), so the link follows a custom port or address rather than assuming
  // :8080. The agent serves its settings at /settings in its web shell.
  const openTarget = localNode ? `${localNode.hostname.replace(/\/+$/, "")}/settings` : null;

  return (
    <div className="mx-4 mt-4 flex items-start gap-3 rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-xs text-text-secondary">
      <Cloud size={16} className="mt-0.5 shrink-0 text-status-warning" />
      <div className="flex-1 space-y-1">
        <p className="font-medium text-text-primary">{t("title")}</p>
        <p className="text-text-tertiary leading-relaxed">{t(feature)}</p>
      </div>
      {openTarget ? (
        <a
          href={openTarget}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded border border-border-default bg-bg-secondary px-2 py-1 text-xs text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          {t("openSetup")}
          <ExternalLink size={11} />
        </a>
      ) : null}
    </div>
  );
}
