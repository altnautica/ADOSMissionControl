"use client";

/**
 * @module ground-station/CarriedDronesTab
 * @description Renders the "Carried drones" surface for a ground-station node:
 * the aircraft this box is relaying, when each was last actually heard, and
 * what authority this ground node holds over it.
 *
 * Reach was only ever modelled drone-side — from the drone's panel you can see
 * which ground node carries it, but standing on the ground node, the node
 * physically holding the radio, there was nothing but a single monospace
 * device id on the overview. "Why can't I reach the drone" was undiagnosable
 * from the half of the link that would answer it.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Plane } from "lucide-react";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { extractLinkedPeers } from "@/lib/agent/relayed-peers";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useUiStore } from "@/stores/ui-store";
import { PageIntro } from "@/components/hardware/PageIntro";
import { HintChip } from "@/components/hardware/HintChip";
import { StatusDot } from "@/components/ui/status-dot";

/** Beyond this, a peer decode is history rather than a live link. */
const HEARD_FRESH_MS = 60_000;

function ageLabel(
  at: number | null,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (at === null) return t("neverHeard");
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return t("heardSecondsAgo", { seconds: secs });
  return t("heardMinutesAgo", { minutes: Math.round(secs / 60) });
}

export function CarriedDronesTab({
  nodeDeviceId,
}: {
  nodeDeviceId: string | null;
}) {
  const t = useTranslations("groundStationOverview.carriedDrones");
  const status = useCommandFleetStore((s) =>
    nodeDeviceId ? s.cloudStatuses[nodeDeviceId] : undefined,
  );
  const drones = useFleetStore((s) => s.drones);
  // Whether the GCS holds this ground node's LAN credentials. That, and only
  // that, is what makes the relay-proxy route usable — so it is what decides
  // the authority sentence below.
  const groundPairedLocally = useLocalNodesStore((s) =>
    nodeDeviceId ? s.nodes.some((n) => n.deviceId === nodeDeviceId) : false,
  );
  const setPendingDetailTab = useUiStore((s) => s.setPendingDetailTab);

  const peers = extractLinkedPeers(status);

  return (
    <div className="flex flex-col">
      <PageIntro
        title={t("title")}
        description={t("description")}
        trailing={<HintChip>{t("hint")}</HintChip>}
      />
      {peers.length === 0 ? (
        <p className="text-sm text-text-tertiary">{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {peers.map((peer) => {
            const nodeId = nodeIdForDevice(peer.deviceId);
            const row = drones.find(
              (d) => d.id === nodeId || d.cloudDeviceId === peer.deviceId,
            );
            const seenAt =
              typeof peer.seenAtUnix === "number" && peer.seenAtUnix > 0
                ? peer.seenAtUnix * 1000
                : null;
            const heardRecently =
              seenAt !== null && Date.now() - seenAt < HEARD_FRESH_MS;
            return (
              <li
                key={peer.deviceId}
                className="rounded-sm border border-border-default bg-surface-secondary p-3"
              >
                <div className="flex items-center gap-2">
                  <Plane size={14} className="text-text-tertiary shrink-0" />
                  <button
                    type="button"
                    onClick={() => {
                      useDroneManager
                        .getState()
                        .selectDrone(row?.id ?? nodeId);
                      setPendingDetailTab("overview");
                    }}
                    className="text-sm font-medium text-accent-primary hover:underline cursor-pointer truncate"
                  >
                    {row?.name ?? peer.deviceId}
                  </button>
                  <StatusDot
                    status={heardRecently ? "good" : "offline"}
                    size="xs"
                    label={ageLabel(seenAt, t)}
                  />
                  <span className="text-[11px] text-text-tertiary">
                    {ageLabel(seenAt, t)}
                  </span>
                  {peer.rssiDbm != null && (
                    <span className="text-[11px] font-mono text-text-tertiary">
                      {peer.rssiDbm} dBm
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-text-secondary">
                  {groundPairedLocally
                    ? t("authorityFull")
                    : t("authorityNotPaired")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
